import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Person } from './people.entity';
import { EnrollDto } from './dto/enroll.dto';

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
  ) {}

  /**
   * Return all people without the face descriptor (safe for API responses).
   */
  async findAll(): Promise<PersonPublic[]> {
    const people = await this.personRepo.find({
      select: ['id', 'name', 'role', 'createdAt'],
      order: { name: 'ASC' },
    });
    return people;
  }

  /**
   * Return all people INCLUDING face descriptors (used by recognition service).
   */
  async findAllWithDescriptors(): Promise<Person[]> {
    return this.personRepo.find({ order: { id: 'ASC' } });
  }

  /**
   * Enroll a new person with their face descriptor.
   */
  async enroll(dto: EnrollDto): Promise<{ id: number; name: string }> {
    const person = this.personRepo.create({
      name: dto.name.trim(),
      role: (dto.role || 'Employee').trim(),
      faceDescriptor: dto.descriptor,
    });
    const saved = await this.personRepo.save(person);
    return { id: saved.id, name: saved.name };
  }

  /**
   * Delete a person by ID.
   */
  async remove(id: number): Promise<void> {
    const person = await this.personRepo.findOne({ where: { id } });
    if (!person) {
      throw new NotFoundException(`Person with id ${id} not found`);
    }
    await this.personRepo.remove(person);
  }

  /**
   * Count total enrolled people.
   */
  async count(): Promise<number> {
    return this.personRepo.count();
  }
}
