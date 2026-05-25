import { Injectable, NotFoundException } from '@nestjs/common';
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

@Injectable()
export class PeopleService {
  constructor(
    @InjectRepository(Person)
    private readonly personRepo: Repository<Person>,
    private readonly descriptorCache: DescriptorCache,
  ) {}

  async findAll(): Promise<PersonPublic[]> {
    const people = await this.personRepo.find({
      select: ['id', 'employeeId', 'name', 'role', 'station', 'scheduleStart', 'scheduleEnd', 'createdAt'],
      order: { name: 'ASC' },
    });
    return people as PersonPublic[];
  }

  async findAllWithDescriptors(): Promise<Person[]> {
    return this.personRepo.find({ order: { id: 'ASC' } });
  }

  async enroll(dto: EnrollDto): Promise<{ id: number; name: string }> {
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

  async update(id: number, dto: Partial<Omit<EnrollDto, 'descriptor'>>): Promise<PersonPublic> {
    const person = await this.personRepo.findOne({ where: { id } });
    if (!person) throw new NotFoundException(`Person with id ${id} not found`);

    if (dto.employeeId !== undefined) person.employeeId = dto.employeeId?.trim() || null;
    if (dto.name !== undefined) person.name = dto.name.trim();
    if (dto.role !== undefined) person.role = dto.role.trim();
    if (dto.station !== undefined) person.station = dto.station?.trim() || null;
    if (dto.scheduleStart !== undefined) person.scheduleStart = dto.scheduleStart || null;
    if (dto.scheduleEnd !== undefined) person.scheduleEnd = dto.scheduleEnd || null;

    const saved = await this.personRepo.save(person);
    this.descriptorCache.invalidate();
    return {
      id: saved.id,
      employeeId: saved.employeeId,
      name: saved.name,
      role: saved.role,
      station: saved.station,
      scheduleStart: saved.scheduleStart,
      scheduleEnd: saved.scheduleEnd,
      createdAt: saved.createdAt,
    };
  }

  async remove(id: number): Promise<void> {
    const person = await this.personRepo.findOne({ where: { id } });
    if (!person) {
      throw new NotFoundException(`Person with id ${id} not found`);
    }
    await this.personRepo.remove(person);
    this.descriptorCache.invalidate();
  }

  async count(): Promise<number> {
    return this.personRepo.count();
  }

  /** Return distinct station names */
  async getStations(): Promise<string[]> {
    const rows = await this.personRepo
      .createQueryBuilder('p')
      .select('DISTINCT p.station', 'station')
      .where('p.station IS NOT NULL')
      .orderBy('p.station', 'ASC')
      .getRawMany();
    return rows.map((r) => r.station as string);
  }
}
