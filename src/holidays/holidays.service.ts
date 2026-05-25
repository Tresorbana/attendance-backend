import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Holiday } from './holiday.entity';

export interface CreateHolidayDto {
  name: string;
  date: string;
  confirmed?: boolean;
}

@Injectable()
export class HolidaysService {
  constructor(
    @InjectRepository(Holiday)
    private readonly holidayRepo: Repository<Holiday>,
  ) {}

  async findAll(): Promise<Holiday[]> {
    return this.holidayRepo.find({ order: { date: 'ASC' } });
  }

  async findByYear(year: number): Promise<Holiday[]> {
    return this.holidayRepo
      .createQueryBuilder('h')
      .where("h.date LIKE :prefix", { prefix: `${year}-%` })
      .orderBy('h.date', 'ASC')
      .getMany();
  }

  async getHolidayDates(from: Date, to: Date): Promise<Set<string>> {
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);
    const rows = await this.holidayRepo
      .createQueryBuilder('h')
      .where('h.date >= :from', { from: fromStr })
      .andWhere('h.date <= :to', { to: toStr })
      .getMany();
    return new Set(rows.map((h) => h.date));
  }

  async create(dto: CreateHolidayDto): Promise<Holiday> {
    const holiday = this.holidayRepo.create({
      name: dto.name.trim(),
      date: dto.date,
      confirmed: dto.confirmed ?? false,
    });
    return this.holidayRepo.save(holiday);
  }

  async update(id: number, dto: Partial<CreateHolidayDto>): Promise<Holiday> {
    const holiday = await this.holidayRepo.findOne({ where: { id } });
    if (!holiday) throw new NotFoundException(`Holiday ${id} not found`);
    if (dto.name !== undefined) holiday.name = dto.name.trim();
    if (dto.date !== undefined) holiday.date = dto.date;
    if (dto.confirmed !== undefined) holiday.confirmed = dto.confirmed;
    return this.holidayRepo.save(holiday);
  }

  async remove(id: number): Promise<void> {
    const holiday = await this.holidayRepo.findOne({ where: { id } });
    if (!holiday) throw new NotFoundException(`Holiday ${id} not found`);
    await this.holidayRepo.remove(holiday);
  }

  /** Seed default public holidays for a given year if none exist */
  async seedDefaults(year: number): Promise<void> {
    const existing = await this.findByYear(year);
    if (existing.length > 0) return;

    const defaults: CreateHolidayDto[] = [
      { name: "New Year's Day", date: `${year}-01-01`, confirmed: true },
      { name: 'Good Friday', date: this.getGoodFriday(year), confirmed: false },
      { name: 'Easter Monday', date: this.getEasterMonday(year), confirmed: false },
      { name: 'Labour Day', date: `${year}-05-01`, confirmed: true },
      { name: 'Madaraka Day', date: `${year}-06-01`, confirmed: true },
      { name: 'Utamaduni Day', date: `${year}-10-10`, confirmed: true },
      { name: 'Huduma Day', date: `${year}-10-27`, confirmed: true },
      { name: 'Jamhuri Day', date: `${year}-12-12`, confirmed: true },
      { name: 'Christmas Day', date: `${year}-12-25`, confirmed: true },
      { name: 'Boxing Day', date: `${year}-12-26`, confirmed: true },
    ];

    for (const d of defaults) {
      try {
        await this.create(d);
      } catch {
        // ignore duplicate key errors
      }
    }
  }

  /** Compute Good Friday date using the Anonymous Gregorian algorithm */
  private getGoodFriday(year: number): string {
    const easter = this.computeEaster(year);
    const gf = new Date(easter);
    gf.setDate(gf.getDate() - 2);
    return gf.toISOString().slice(0, 10);
  }

  private getEasterMonday(year: number): string {
    const easter = this.computeEaster(year);
    const em = new Date(easter);
    em.setDate(em.getDate() + 1);
    return em.toISOString().slice(0, 10);
  }

  private computeEaster(year: number): Date {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }
}
