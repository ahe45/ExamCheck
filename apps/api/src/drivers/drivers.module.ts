import { Module } from "@nestjs/common";
import { DriversController } from "./drivers.controller.js";

@Module({ controllers: [DriversController] })
export class DriversModule {}
