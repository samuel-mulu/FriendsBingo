import { Controller, Get } from '@nestjs/common';
import { CartelasService } from './cartelas.service';

@Controller('cartelas')
export class CartelasController {
  constructor(private readonly cartelasService: CartelasService) {}

  @Get()
  getCartelas() {
    return this.cartelasService.getCartelas();
  }
}
