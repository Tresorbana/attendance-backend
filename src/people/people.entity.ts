import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('people')
export class Person {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 100, default: 'Student' })
  role: string;

  @Column('float', { array: true, name: 'face_descriptor' })
  faceDescriptor: number[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
