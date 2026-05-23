import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from './shared/shared.module';
import { AuthModule } from './auth/auth.module';
import { PeopleModule } from './people/people.module';
import { AttendanceModule } from './attendance/attendance.module';
import { RecognitionModule } from './recognition/recognition.module';
import { ReportsModule } from './reports/reports.module';
import { Person } from './people/people.entity';
import { Attendance } from './attendance/attendance.entity';

function isSyncEnabled(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  return value === 'true';
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DATABASE_HOST', 'localhost'),
        port: config.get<number>('DATABASE_PORT', 5432),
        username: config.get<string>('DATABASE_USER', 'attendai'),
        password: config.get<string>('DATABASE_PASSWORD', 'attendai_secret'),
        database: config.get<string>('DATABASE_NAME', 'attendai'),
        entities: [Person, Attendance],
        synchronize: isSyncEnabled(
          config.get<string>('DB_SYNCHRONIZE'),
          config.get<string>('NODE_ENV') !== 'production',
        ),
        logging: config.get<string>('NODE_ENV') === 'development',
      }),
      inject: [ConfigService],
    }),
    AuthModule,
    SharedModule,
    PeopleModule,
    AttendanceModule,
    RecognitionModule,
    ReportsModule,
  ],
})
export class AppModule {}
