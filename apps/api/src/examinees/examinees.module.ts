import { Module } from "@nestjs/common";
import { ExamineesController } from "./examinees.controller.js";
import { ExamineesRepository } from "./examinees.repository.js";
import { ExamineesService } from "./examinees.service.js";

@Module({
  controllers: [ExamineesController],
  providers: [ExamineesRepository, ExamineesService],
  exports: [ExamineesService],
})
export class ExamineesModule {}
