import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Person } from './people.entity';
import { EnrollDto } from './dto/enroll.dto';
import { DescriptorCache } from '../shared/descriptor-cache';

export interface PersonPublic {
  id: number;
  name: string;
  role: string;
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
      select: ['id', 'name', 'role', 'createdAt'],
      order: { name: 'ASC' },
    });
    return people;
  }

  async findAllWithDescriptors(): Promise<Person[]> {
    return this.personRepo.find({ order: { id: 'ASC' } });
  }

  async enroll(dto: EnrollDto): Promise<{ id: number; name: string }> {
    const person = this.personRepo.create({
      name: dto.name.trim(),
      role: (dto.role || 'Employee').trim(),
      faceDescriptor: dto.descriptor,
    });
    const saved = await this.personRepo.save(person);
    this.descriptorCache.invalidate();
    return { id: saved.id, name: saved.name };
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
}
