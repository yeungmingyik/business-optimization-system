import { Module } from '@nestjs/common';
import { CoreModule } from '../core.module';
import { TransferController } from './transfer.controller';
import { TransferDataService } from './transfer-data.service';
import { TransferService } from './transfer.service';

@Module({
  imports: [CoreModule],
  controllers: [TransferController],
  providers: [TransferDataService, TransferService],
  exports: [TransferService],
})
export class TransferModule {}
