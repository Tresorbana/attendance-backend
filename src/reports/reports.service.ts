import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Attendance } from '../attendance/attendance.entity';

export interface HourlyBucket {
  hour: number;
  count: number;
  label: string;
}

export interface DailyBucket {
  date: string;
  count: number;
  label: string;
}

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Attendance)
    private readonly attendanceRepo: Repository<Attendance>,
  ) {}

  /**
   * Attendance count per hour for today (0–23).
   */
  async daily(): Promise<HourlyBucket[]> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const rows = await this.attendanceRepo
      .createQueryBuilder('a')
      .select('EXTRACT(HOUR FROM a.timestamp)::int', 'hour')
      .addSelect('COUNT(*)', 'count')
      .where('a.timestamp >= :start', { start: todayStart })
      .andWhere('a.timestamp <= :end', { end: todayEnd })
      .groupBy('hour')
      .orderBy('hour', 'ASC')
      .getRawMany();

    // Build full 24-hour grid
    const countByHour: Record<number, number> = {};
    for (const row of rows) {
      countByHour[Number(row.hour)] = parseInt(row.count, 10);
    }

    const buckets: HourlyBucket[] = [];
    for (let h = 0; h < 24; h++) {
      const period = h < 12 ? 'AM' : 'PM';
      const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
      buckets.push({
        hour: h,
        count: countByHour[h] || 0,
        label: `${displayHour}:00 ${period}`,
      });
    }
    return buckets;
  }

  /**
   * Attendance count per day for the last 7 days.
   */
  async weekly(): Promise<DailyBucket[]> {
    return this.buildDailyBuckets(7);
  }

  /**
   * Attendance count per day for the last 30 days.
   */
  async monthly(): Promise<DailyBucket[]> {
    return this.buildDailyBuckets(30);
  }

  /**
   * Build a bucketed per-day attendance count for the last N days.
   */
  private async buildDailyBuckets(days: number): Promise<DailyBucket[]> {
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    start.setHours(0, 0, 0, 0);

    const rows = await this.attendanceRepo
      .createQueryBuilder('a')
      .select("TO_CHAR(a.timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD')", 'date')
      .addSelect('COUNT(*)', 'count')
      .where('a.timestamp >= :start', { start })
      .groupBy('date')
      .orderBy('date', 'ASC')
      .getRawMany();

    const countByDate: Record<string, number> = {};
    for (const row of rows) {
      countByDate[row.date] = parseInt(row.count, 10);
    }

    const buckets: DailyBucket[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10); // YYYY-MM-DD
      const label = d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
      buckets.push({
        date: key,
        count: countByDate[key] || 0,
        label,
      });
    }
    return buckets;
  }

  /**
   * Build a CSV string from attendance records within the given date range.
   */
  async exportCsv(from?: string, to?: string): Promise<string> {
    const qb = this.attendanceRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.person', 'person')
      .orderBy('a.timestamp', 'ASC');

    if (from) {
      qb.andWhere('a.timestamp >= :from', { from: new Date(from) });
    }
    if (to) {
      const toDate = new Date(to);
      toDate.setDate(toDate.getDate() + 1);
      qb.andWhere('a.timestamp < :to', { to: toDate });
    }

    const records = await qb.getMany();

    const header = 'ID,Person ID,Name,Role,Timestamp,Confidence\r\n';
    const rows = records.map((r) => {
      const name = (r.person?.name || '').replace(/"/g, '""');
      const role = (r.person?.role || '').replace(/"/g, '""');
      const ts = r.timestamp ? new Date(r.timestamp).toISOString() : '';
      const confidence = (r.confidence * 100).toFixed(2) + '%';
      return `${r.id},${r.personId},"${name}","${role}",${ts},${confidence}`;
    });

    return header + rows.join('\r\n');
  }
}
