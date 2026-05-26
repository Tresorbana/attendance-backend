import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Person } from './people.entity';
import { EnrollDto } from './dto/enroll.dto';
import { DescriptorCache } from '../shared/descriptor-cache';

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

/** Returned when a duplicate is detected before saving */
export interface DuplicateCheckResult {
  isDuplicate: boolean;
  reason?: 'employee_id' | 'face' | 'name';
  existingPerson?: PersonPublic;
  /** Face similarity distance (lower = more similar). Only set when reason='face' */
  faceDistance?: number;
}

@Injectable()
export class PeopleService {
  /** Face distance below this is considered a duplicate (same person) */
  private readonly FACE_DUPLICATE_THRESHOLD = 0.45;

  constructor(
    @InjectRepository(Person)
    private readonly personRepo: Repository<Person>,
    private readonly descriptorCache: DescriptorCache,
  ) {}

  async findAll(station?: string): Promise<PersonPublic[]> {
    // Use find() with select — more reliable than QueryBuilder partial select
    // which can silently return empty results if column mapping fails.
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

  async findAllWithDescriptors(): Promise<Person[]> {
    return this.personRepo.find({ order: { id: 'ASC' } });
  }

  /**
   * Check for duplicates before enrolling.
   * Checks:
   *   1. Duplicate employeeId (if provided)
   *   2. Duplicate face descriptor (euclidean distance < threshold)
   *   3. Exact name match (case-insensitive, same station)
   */
  async checkDuplicate(dto: EnrollDto): Promise<DuplicateCheckResult> {
    // 1. Check employee ID uniqueness
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

    // 2. Check face similarity against all enrolled people
    const allPeople = await this.personRepo.find();
    let closestPerson: Person | null = null;
    let closestDistance = Infinity;

    for (const person of allPeople) {
      if (!person.faceDescriptor || person.faceDescriptor.length < 128) continue;
      const dist = this.euclideanDistance(dto.descriptor, person.faceDescriptor);
      if (dist < closestDistance) {
        closestDistance = dist;
        closestPerson = person;
      }
    }

    if (closestPerson && closestDistance < this.FACE_DUPLICATE_THRESHOLD) {
      return {
        isDuplicate: true,
        reason: 'face',
        existingPerson: this.toPublic(closestPerson),
        faceDistance: closestDistance,
      };
    }

    // 3. Check exact name + station match
    const nameMatch = await this.personRepo
      .createQueryBuilder('p')
      .where('LOWER(p.name) = LOWER(:name)', { name: dto.name.trim() })
      .andWhere(
        dto.station?.trim()
          ? 'p.station = :station'
          : 'p.station IS NULL',
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
    // Guard: reject duplicates
    const dupCheck = await this.checkDuplicate(dto);
    if (dupCheck.isDuplicate) {
      const msg = this.duplicateMessage(dupCheck);
      throw new ConflictException(msg);
    }

    const person = this.personRepo.create({
      employeeId: dto.employeeId?.trim() || null,
      name: dto.name.trim(),
      role: (dto.role || 'Employee').trim(),
      station: dto.station?.trim() || null,
      scheduleStart: dto.scheduleStart || null,
      scheduleEnd: dto.scheduleEnd || null,
      faceDescriptor: dto.descriptor,
    });
    const saved = await this.personRepo.save(person);
    this.descriptorCache.invalidate();
    return { id: saved.id, name: saved.name };
  }

  async update(
    id: number,
    dto: Partial<Omit<EnrollDto, 'descriptor'>>,
  ): Promise<PersonPublic> {
    const person = await this.personRepo.findOne({ where: { id } });
    if (!person) throw new NotFoundException(`Person with id ${id} not found`);

    // If changing employeeId, check it's not taken by another person
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

    if (dto.employeeId !== undefined)
      person.employeeId = dto.employeeId?.trim() || null;
    if (dto.name !== undefined) person.name = dto.name.trim();
    if (dto.role !== undefined) person.role = dto.role.trim();
    if (dto.station !== undefined)
      person.station = dto.station?.trim() || null;
    if (dto.scheduleStart !== undefined)
      person.scheduleStart = dto.scheduleStart || null;
    if (dto.scheduleEnd !== undefined)
      person.scheduleEnd = dto.scheduleEnd || null;

    const saved = await this.personRepo.save(person);
    this.descriptorCache.invalidate();
    return this.toPublic(saved);
  }

  async remove(id: number): Promise<void> {
    const person = await this.personRepo.findOne({ where: { id } });
    if (!person) throw new NotFoundException(`Person with id ${id} not found`);
    await this.personRepo.remove(person);
    this.descriptorCache.invalidate();
  }

  async count(): Promise<number> {
    return this.personRepo.count();
  }

  /** Return distinct station names (from people table) */
  async getStations(): Promise<string[]> {
    const rows = await this.personRepo
      .createQueryBuilder('p')
      .select('DISTINCT p.station', 'station')
      .where('p.station IS NOT NULL')
      .orderBy('p.station', 'ASC')
      .getRawMany();
    return rows.map((r) => r.station as string);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

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

  private euclideanDistance(a: number[], b: number[]): number {
    let sum = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) sum += (a[i] - b[i]) ** 2;
    return Math.sqrt(sum);
  }

  private duplicateMessage(check: DuplicateCheckResult): string {
    switch (check.reason) {
      case 'employee_id':
        return `Employee ID "${check.existingPerson?.employeeId}" is already registered to ${check.existingPerson?.name}.`;
      case 'face':
        return `This face is already registered as "${check.existingPerson?.name}" (similarity: ${((1 - (check.faceDistance ?? 0)) * 100).toFixed(0)}%). Cannot enroll duplicate.`;
      case 'name':
        return `An employee named "${check.existingPerson?.name}" already exists at this station.`;
      default:
        return 'Duplicate employee detected.';
    }
  }
}
