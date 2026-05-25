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

  // Explicit type: 'varchar' is required — TypeScript union `string | null`
  // causes TypeORM to emit "Object" via reflect-metadata, which postgres rejects.
  @Column({ type: 'varchar', name: 'employee_id', length: 50, unique: true, nullable: true })
  employeeId: string | null;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 100, default: 'Employee' })
  role: string;

  @Column({ type: 'varchar', length: 150, nullable: true, name: 'station' })
  station: string | null;

  /** Expected check-in time, e.g. "08:00" */
  @Column({ type: 'varchar', length: 10, nullable: true, name: 'schedule_start' })
  scheduleStart: string | null;

  /** Expected check-out time, e.g. "17:00" */
  @Column({ type: 'varchar', length: 10, nullable: true, name: 'schedule_end' })
  scheduleEnd: string | null;

  @Column('float', { array: true, name: 'face_descriptor' })
  faceDescriptor: number[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
