import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, ILike, MoreThanOrEqual } from 'typeorm';
import { Attendance } from './attendance.entity';
import { PeopleService } from '../people/people.service';

export interface AttendanceRecord {
  id: number;
  person_id: number;
  name: string;
  role: string;
  timestamp: Date;
  confidence: number;
}

export interface StatsResponse {
  totalPeople: number;
  todayCount: number;
  attendanceRate: number;
  lastCheckIn: Date | null;
}

@Injectable()
export class AttendanceService {
  constructor(
    @InjectRepository(Attendance)
    private readonly attendanceRepo: Repository<Attendance>,
    private readonly peopleService: PeopleService,
  ) {}

  /**
   * Record a new attendance check-in.
   */
  async record(personId: number, confidence: number): Promise<Attendance> {
    const entry = this.attendanceRepo.create({
      personId,
      confidence,
      timestamp: new Date(),
    });
    return this.attendanceRepo.save(entry);
  }

  /**
   * Get the most recent attendance record for a person.
   */
  async getLastForPerson(personId: number): Promise<Attendance | null> {
    return this.attendanceRepo.findOne({
      where: { personId },
      order: { timestamp: 'DESC' },
    });
  }

  /**
   * Get the most recent N attendance records.
   */
  async getRecent(limit = 10): Promise<AttendanceRecord[]> {
    const records = await this.attendanceRepo.find({
      order: { timestamp: 'DESC' },
      take: limit,
      relations: ['person'],
    });
    return this.formatRecords(records);
  }

  /**
   * Get all attendance records with optional filters.
   */
  async getAll(from?: string, to?: string, search?: string): Promise<AttendanceRecord[]> {
    const qb = this.attendanceRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.person', 'person')
      .orderBy('a.timestamp', 'DESC');

    if (from) {
      qb.andWhere('a.timestamp >= :from', { from: new Date(from) });
    }
    if (to) {
      // Include the entire "to" day by advancing to the next day
      const toDate = new Date(to);
      toDate.setDate(toDate.getDate() + 1);
      qb.andWhere('a.timestamp < :to', { to: toDate });
    }
    if (search && search.trim()) {
      qb.andWhere('person.name ILIKE :search', { search: `%${search.trim()}%` });
    }

    const records = await qb.getMany();
    return this.formatRecords(records);
  }

  /**
   * Compute dashboard stats.
   */
  async getStats(): Promise<StatsResponse> {
    const totalPeople = await this.peopleService.count();

    // Today's start (midnight local)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayCount = await this.attendanceRepo.count({
      where: { timestamp: MoreThanOrEqual(todayStart) },
    });

    // Unique people who checked in today
    const uniqueTodayResult = await this.attendanceRepo
      .createQueryBuilder('a')
      .select('COUNT(DISTINCT a.person_id)', 'count')
      .where('a.timestamp >= :todayStart', { todayStart })
      .getRawOne();
    const uniqueToday = parseInt(uniqueTodayResult?.count || '0', 10);

    const attendanceRate =
      totalPeople > 0 ? Math.round((uniqueToday / totalPeople) * 100) : 0;

    const [lastRecord] = await this.attendanceRepo.find({
      order: { timestamp: 'DESC' },
      take: 1,
    });

    return {
      totalPeople,
      todayCount,
      attendanceRate,
      lastCheckIn: lastRecord?.timestamp || null,
    };
  }

  /**
   * Format raw Attendance entities to the AttendanceRecord shape.
   */
  private formatRecords(records: Attendance[]): AttendanceRecord[] {
    return records.map((r) => ({
      id: r.id,
      person_id: r.personId,
      name: r.person?.name || 'Unknown',
      role: r.person?.role || 'Unknown',
      timestamp: r.timestamp,
      confidence: r.confidence,
    }));
  }

  /**
   * Raw query helper for reports — returns attendance rows joined with person.
   */
  async getRawForReport(from?: Date, to?: Date): Promise<Attendance[]> {
    const qb = this.attendanceRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.person', 'person')
      .orderBy('a.timestamp', 'ASC');

    if (from) qb.andWhere('a.timestamp >= :from', { from });
    if (to) qb.andWhere('a.timestamp < :to', { to });

    return qb.getMany();
  }
}
