import { Controller, Get, Header, NotFoundException, Param, StreamableFile, UseGuards } from "@nestjs/common";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { AuthGuard } from "../auth/auth.guard.js";
import { RequirePermissions } from "../auth/permissions.js";
import { RolesGuard } from "../auth/roles.js";
import { DRIVER_FILES, isDriverId, resolveDriverPath } from "./driver-files.js";

@Controller("drivers")
@UseGuards(AuthGuard, RolesGuard)
@RequirePermissions("driver.download")
export class DriversController {
  @Get(":driverId")
  @Header("Cache-Control", "private, no-store")
  @Header("X-Content-Type-Options", "nosniff")
  async download(@Param("driverId") driverId: string): Promise<StreamableFile> {
    if (!isDriverId(driverId)) throw new NotFoundException("지원하지 않는 드라이버입니다.");

    const driver = DRIVER_FILES[driverId];
    const filePath = resolveDriverPath(driverId);
    let fileStat;
    try {
      fileStat = await stat(filePath);
    } catch {
      throw new NotFoundException("드라이버 설치 파일을 찾을 수 없습니다.");
    }
    if (!fileStat.isFile()) throw new NotFoundException("드라이버 설치 파일을 찾을 수 없습니다.");

    return new StreamableFile(createReadStream(filePath), {
      type: "application/octet-stream",
      disposition: `attachment; filename="${driver.fileName}"`,
      length: fileStat.size,
    });
  }
}
