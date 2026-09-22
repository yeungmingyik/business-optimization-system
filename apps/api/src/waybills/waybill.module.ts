import { Module } from '@nestjs/common';
import { CoreModule } from '../core.module';
import { WaybillController } from './waybill.controller';
import { WaybillService } from './waybill.service';
import { WaybillRecognitionService } from './waybill-recognition.service';

@Module({
  imports: [CoreModule],
  controllers: [WaybillController],
  providers: [WaybillService, WaybillRecognitionService],
})
export class WaybillModule {}
