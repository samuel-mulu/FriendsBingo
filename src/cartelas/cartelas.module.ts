import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CartelasController } from './cartelas.controller';
import { CartelasService } from './cartelas.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CartelasController],
  providers: [CartelasService],
  exports: [CartelasService],
})
export class CartelasModule {}
