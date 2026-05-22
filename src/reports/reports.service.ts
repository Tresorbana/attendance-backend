import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Attendance } from '../attendance/attendance.entity';
import { PeopleService } from '../people/people.service';

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

export interface PresentToday {
  present: number;
  total: number;
  absent: number;
}

export interface RoleBucket {
  role: string;
  count: number;
}

export interface CalendarDay {
  date: string;
  count: number;
}

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Attendance)
    private readonly attendanceRepo: Repository<Attendance>,
    private readonly peopleService: PeopleService,
  ) {}

  private todayBounds() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  async daily(): Promise<HourlyBucket[]> {
    const { start, end } = this.todayBounds();

    const rows = await this.attendanceRepo
      .createQueryBuilder('a')
      .select('EXTRACT(HOUR FROM a.timestamp)::int', 'hour')
      .addSelect('COUNT(*)', 'count')
      .where('a.timestamp >= :start', { start })
      .andWhere('a.timestamp <= :end', { end })
      .groupBy('hour')
      .orderBy('hour', 'ASC')
      .getRawMany();

    const countByHour: Record<number, number> = {};
    for (const row of rows) {
      countByHour[Number(row.hour)] = parseInt(row.count, 10);
    }

    const buckets: HourlyBucket[] = [];
    for (let h = 0; h < 24; h++) {
      const period = h < 12 ? 'AM' : 'PM';
      const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
      buckets.push({ hour: h, count: countByHour[h] || 0, label: `${displayHour}:00 ${period}` });
    }
    return buckets;
  }

  async weekly(): Promise<DailyBucket[]> {
    return this.buildDailyBuckets(7);
  }

  async monthly(): Promise<DailyBucket[]> {
    return this.buildDailyBuckets(30);
  }

  /**
   * Distinct employees who clocked in today vs total enrolled.
   */
  async presentToday(): Promise<PresentToday> {
    const { start } = this.todayBounds();
    const [total, presentResult] = await Promise.all([
      this.peopleService.count(),
      this.attendanceRepo
        .createQueryBuilder('a')
        .select('COUNT(DISTINCT a.person_id)', 'count')
        .where('a.timestamp >= :start', { start })
        .getRawOne(),
    ]);
    const present = parseInt(presentResult?.count || '0', 10);
    return { present, total, absent: Math.max(0, total - present) };
  }

  /**
   * Distinct employees who clocked in today grouped by role.
   */
  async byRole(): Promise<RoleBucket[]> {
    const { start } = this.todayBounds();
    const rows = await this.attendanceRepo
      .createQueryBuilder('a')
      .leftJoin('a.person', 'person')
      .select('person.role', 'role')
      .addSelect('COUNT(DISTINCT a.person_id)', 'count')
      .where('a.timestamp >= :start', { start })
      .groupBy('person.role')
      .orderBy('count', 'DESC')
      .getRawMany();
    return rows.map((r) => ({ role: r.role || 'Unknown', count: parseInt(r.count, 10) }));
  }

  /**
   * Returns one entry per calendar day for the given year/month (1-indexed),
   * with the count of distinct employees who clocked in that day.
   */
  async calendarMonth(year: number, month: number): Promise<CalendarDay[]> {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59, 999);
    const daysInMonth = end.getDate();

    const rows = await this.attendanceRepo
      .createQueryBuilder('a')
      .select("TO_CHAR(a.timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD')", 'date')
      .addSelect('COUNT(DISTINCT a.person_id)', 'count')
      .where('a.timestamp >= :start', { start })
      .andWhere('a.timestamp <= :end', { end })
      .groupBy('date')
      .getRawMany();

    const countByDate: Record<string, number> = {};
    for (const row of rows) {
      countByDate[row.date] = parseInt(row.count, 10);
    }

    const result: CalendarDay[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      result.push({ date: dateStr, count: countByDate[dateStr] || 0 });
    }
    return result;
  }

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
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      buckets.push({ date: key, count: countByDate[key] || 0, label });
    }
    return buckets;
  }

  async exportCsv(from?: string, to?: string): Promise<string> {
    const qb = this.attendanceRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.person', 'person')
      .orderBy('a.timestamp', 'ASC');

    if (from) qb.andWhere('a.timestamp >= :from', { from: new Date(from) });
    if (to) {
      const toDate = new Date(to);
      toDate.setDate(toDate.getDate() + 1);
      qb.andWhere('a.timestamp < :to', { to: toDate });
    }

    const records = await qb.getMany();
    const generatedAt = new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });
    const period = from || to ? `${from || 'all time'} to ${to || 'today'}` : 'all records';

    const summary = [
      `"AttendAI — Attendance Report"`,
      `"Generated","${generatedAt}"`,
      `"Period","${period}"`,
      `"Total records","${records.length}"`,
      ``,
    ].join('\r\n');

    const header = `Date,Employee Name,Role,Check-in Time`;
    const rows = records.map((r) => {
      const name = (r.person?.name || '').replace(/"/g, '""');
      const role = (r.person?.role || '').replace(/"/g, '""');
      const ts = r.timestamp ? new Date(r.timestamp) : null;
      const date = ts ? ts.toLocaleDateString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '';
      const time = ts ? ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
      return `${date},"${name}","${role}",${time}`;
    });

    return summary + header + '\r\n' + rows.join('\r\n');
  }
}
