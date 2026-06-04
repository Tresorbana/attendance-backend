import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Person } from './people.entity';
import { EnrollDto } from './dto/enroll.dto';
import { FingerprintCache } from '../shared/fingerprint-cache';
import { isPngBase64, processFingerprintPng } from '../shared/image-utils';
import { PythonPipelineService } from '../fingerprint/python-pipeline.service';

export interface PersonPublic {
  id: number;
  employeeId: string | null;
  name: string;
  role: string;
  station: string | null;
  scheduleStart: string | null;
  scheduleEnd: string | null;
  createdAt: Date;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  reason?: 'employee_id' | 'name';
  existingPerson?: PersonPublic;
}

@Injectable()
export class PeopleService {
  constructor(
    @InjectRepository(Person)
    private readonly personRepo: Repository<Person>,
    private readonly fingerprintCache: FingerprintCache,
    private readonly pythonPipeline: PythonPipelineService,
  ) {}

  async findAll(station?: string): Promise<PersonPublic[]> {
    const people = await this.personRepo.find({
      select: {
        id: true,
        employeeId: true,
        name: true,
        role: true,
        station: true,
        scheduleStart: true,
        scheduleEnd: true,
        createdAt: true,
      },
      where: station ? { station } : undefined,
      order: { name: 'ASC' },
    });
    return people as PersonPublic[];
  }

  /** Returns all people WITH their fingerprint templates (for recognition). */
  async findAllWithTemplates(): Promise<Person[]> {
    return this.personRepo.find({ order: { id: 'ASC' } });
  }


  async checkDuplicate(dto: EnrollDto): Promise<DuplicateCheckResult> {
    // 1. Employee ID uniqueness
    if (dto.employeeId?.trim()) {
      const existing = await this.personRepo.findOne({
        where: { employeeId: dto.employeeId.trim() },
      });
      if (existing) {
        return {
          isDuplicate: true,
          reason: 'employee_id',
          existingPerson: this.toPublic(existing),
        };
      }
    }

    // 2. Exact name + station match
    const nameMatch = await this.personRepo
      .createQueryBuilder('p')
      .where('LOWER(p.name) = LOWER(:name)', { name: dto.name.trim() })
      .andWhere(
        dto.station?.trim() ? 'p.station = :station' : 'p.station IS NULL',
        { station: dto.station?.trim() },
      )
      .getOne();

    if (nameMatch) {
      return {
        isDuplicate: true,
        reason: 'name',
        existingPerson: this.toPublic(nameMatch),
      };
    }

    return { isDuplicate: false };
  }

  async enroll(dto: EnrollDto): Promise<{ id: number; name: string }> {
    const dupCheck = await this.checkDuplicate(dto);
    if (dupCheck.isDuplicate) {
      throw new ConflictException(this.duplicateMessage(dupCheck));
    }

    // WebAuthn path: fingerprint data lives in webauthn_credentials, not here.
    // "pending" is the placeholder sent by the enroll UI before Windows Hello runs.
    const isWebAuthn = dto.fingerprintTemplate === 'pending' || !dto.fingerprintTemplate;

    let fingerprintTemplate: string | null = null;

    if (!isWebAuthn) {
      const processOne = async (raw: string) =>
        isPngBase64(raw) ? processFingerprintPng(raw) : raw;

      const raws = dto.fingerprintTemplates?.length
        ? dto.fingerprintTemplates
        : [dto.fingerprintTemplate as string];

      const processed = await Promise.all(raws.map(processOne));
      const minutiaeArray = processed.map((t) => JSON.parse(t));

      fingerprintTemplate = minutiaeArray.length === 1
        ? processed[0]
        : JSON.stringify(minutiaeArray);
    }

    const person = this.personRepo.create({
      employeeId: dto.employeeId?.trim() || null,
      name: dto.name.trim(),
      role: (dto.role || 'Employee').trim(),
      station: dto.station?.trim() || null,
      scheduleStart: dto.scheduleStart || null,
      scheduleEnd: dto.scheduleEnd || null,
      fingerprintTemplate,
    });
    const saved = await this.personRepo.save(person);
    this.fingerprintCache.invalidate();
    return { id: saved.id, name: saved.name };
  }

  async update(
    id: number,
    dto: Partial<Omit<EnrollDto, 'fingerprintTemplate'>>,
  ): Promise<PersonPublic> {
    const person = await this.personRepo.findOne({ where: { id } });
    if (!person) throw new NotFoundException(`Person with id ${id} not found`);

    if (dto.employeeId !== undefined && dto.employeeId?.trim()) {
      const conflict = await this.personRepo.findOne({
        where: { employeeId: dto.employeeId.trim() },
      });
      if (conflict && conflict.id !== id) {
        throw new ConflictException(
          `Employee ID "${dto.employeeId}" is already assigned to ${conflict.name}`,
        );
      }
    }

    if (dto.employeeId !== undefined) person.employeeId = dto.employeeId?.trim() || null;
    if (dto.name !== undefined) person.name = dto.name.trim();
    if (dto.role !== undefined) person.role = dto.role.trim();
    if (dto.station !== undefined) person.station = dto.station?.trim() || null;
    if (dto.scheduleStart !== undefined) person.scheduleStart = dto.scheduleStart || null;
    if (dto.scheduleEnd !== undefined) person.scheduleEnd = dto.scheduleEnd || null;

    const saved = await this.personRepo.save(person);
    this.fingerprintCache.invalidate();
    return this.toPublic(saved);
  }

  async remove(id: number): Promise<void> {
    const person = await this.personRepo.findOne({ where: { id } });
    if (!person) throw new NotFoundException(`Person with id ${id} not found`);
    await this.personRepo.remove(person);
    this.fingerprintCache.invalidate();
    void this.pythonPipeline.deletePerson(String(id));
  }

  async count(): Promise<number> {
    return this.personRepo.count();
  }

  async getStations(): Promise<string[]> {
    const rows = await this.personRepo
      .createQueryBuilder('p')
      .select('DISTINCT p.station', 'station')
      .where('p.station IS NOT NULL')
      .orderBy('p.station', 'ASC')
      .getRawMany();
    return rows.map((r) => r.station as string);
  }

  private toPublic(p: Person): PersonPublic {
    return {
      id: p.id,
      employeeId: p.employeeId,
      name: p.name,
      role: p.role,
      station: p.station,
      scheduleStart: p.scheduleStart,
      scheduleEnd: p.scheduleEnd,
      createdAt: p.createdAt,
    };
  }

  private duplicateMessage(check: DuplicateCheckResult): string {
    switch (check.reason) {
      case 'employee_id':
        return `Employee ID "${check.existingPerson?.employeeId}" is already registered to ${check.existingPerson?.name}.`;
      case 'name':
        return `An employee named "${check.existingPerson?.name}" already exists at this station.`;
      default:
        return 'Duplicate employee detected.';
    }
  }
}
