import { Global, Module } from '@nestjs/common';
import { JobsQueueService } from './jobs-queue.service';

@Global()
@Module({
  providers: [JobsQueueService],
  exports: [JobsQueueService],
})
export class JobsModule {}
