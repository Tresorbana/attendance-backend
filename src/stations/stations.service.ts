import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Station } from './station.entity';
import { CreateStationDto } from './dto/create-station.dto';

export interface StationPublic {
  id: number;
  name: string;
  code: string | null;
  address: string | null;
  adminUsername: string | null;
  adminFullName: string | null;
  active: boolean;
  createdAt: Date;
}

@Injectable()
export class StationsService {
  constructor(
    @InjectRepository(Station)
    private readonly stationRepo: Repository<Station>,
  ) {}

  async findAll(): Promise<StationPublic[]> {
    const stations = await this.stationRepo.find({ order: { name: 'ASC' } });
    return stations.map(this.toPublic);
  }

  async findOne(id: number): Promise<StationPublic> {
    const s = await this.stationRepo.findOne({ where: { id } });
    if (!s) throw new NotFoundException(`Station ${id} not found`);
    return this.toPublic(s);
  }

  async findNames(): Promise<string[]> {
    const rows = await this.stationRepo.find({
      select: ['name'],
      where: { active: true },
      order: { name: 'ASC' },
    });
    return rows.map((r) => r.name);
  }

  async create(dto: CreateStationDto): Promise<StationPublic> {
    const existing = await this.stationRepo.findOne({ where: { name: dto.name.trim() } });
    if (existing) throw new ConflictException(`Station "${dto.name}" already exists`);

    const station = this.stationRepo.create({
      name: dto.name.trim(),
      code: dto.code?.trim() || null,
      address: dto.address?.trim() || null,
      adminUsername: dto.adminUsername?.trim() || null,
      adminPassword: dto.adminPassword || null,
      adminFullName: dto.adminFullName?.trim() || null,
    });
    const saved = await this.stationRepo.save(station);
    return this.toPublic(saved);
  }

  async update(id: number, dto: Partial<CreateStationDto>): Promise<StationPublic> {
    const station = await this.stationRepo.findOne({ where: { id } });
    if (!station) throw new NotFoundException(`Station ${id} not found`);

    if (dto.name !== undefined) station.name = dto.name.trim();
    if (dto.code !== undefined) station.code = dto.code?.trim() || null;
    if (dto.address !== undefined) station.address = dto.address?.trim() || null;
    if (dto.adminUsername !== undefined) station.adminUsername = dto.adminUsername?.trim() || null;
    if (dto.adminPassword !== undefined) station.adminPassword = dto.adminPassword || null;
    if (dto.adminFullName !== undefined) station.adminFullName = dto.adminFullName?.trim() || null;

    const saved = await this.stationRepo.save(station);
    return this.toPublic(saved);
  }

  async remove(id: number): Promise<void> {
    const station = await this.stationRepo.findOne({ where: { id } });
    if (!station) throw new NotFoundException(`Station ${id} not found`);
    await this.stationRepo.remove(station);
  }

  /** Used by auth service to validate station-admin login */
  async findByAdminUsername(username: string): Promise<Station | null> {
    return this.stationRepo.findOne({
      where: { adminUsername: username, active: true },
    });
  }

  /**
   * Seed 3 demo stations with portal credentials.
   * Safe to call multiple times — skips existing stations.
   */
  async seedDemoStations(): Promise<{ created: StationPublic[]; skipped: string[] }> {
    const demos = [
      {
        name: 'Nairobi HQ',
        code: 'NBI-HQ',
        address: 'Upperhill, Nairobi',
        adminUsername: 'nairobi_admin',
        adminPassword: 'Nairobi@2026',
        adminFullName: 'Nairobi Branch Admin',
      },
      {
        name: 'Mombasa Branch',
        code: 'MSA-BR',
        address: 'Nyali, Mombasa',
        adminUsername: 'mombasa_admin',
        adminPassword: 'Mombasa@2026',
        adminFullName: 'Mombasa Branch Admin',
      },
      {
        name: 'Kisumu Office',
        code: 'KSM-OF',
        address: 'Milimani, Kisumu',
        adminUsername: 'kisumu_admin',
        adminPassword: 'Kisumu@2026',
        adminFullName: 'Kisumu Office Admin',
      },
    ];

    const created: StationPublic[] = [];
    const skipped: string[] = [];

    for (const demo of demos) {
      const existing = await this.stationRepo.findOne({ where: { name: demo.name } });
      if (existing) {
        skipped.push(demo.name);
        continue;
      }
      const station = this.stationRepo.create(demo);
      const saved = await this.stationRepo.save(station);
      created.push(this.toPublic(saved));
    }

    return { created, skipped };
  }

  private toPublic(s: Station): StationPublic {
    return {
      id: s.id,
      name: s.name,
      code: s.code,
      address: s.address,
      adminUsername: s.adminUsername,
      adminFullName: s.adminFullName,
      active: s.active,
      createdAt: s.createdAt,
    };
  }
}
