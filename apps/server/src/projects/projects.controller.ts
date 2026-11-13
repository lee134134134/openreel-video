import { Body, Controller, Delete, Get, Param, Post, Put } from "@nestjs/common";
import { ProjectsService } from "./projects.service";

@Controller("projects")
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(): unknown {
    return this.projects.list();
  }

  @Get(":id")
  get(@Param("id") id: string): unknown {
    return this.projects.get(id) ?? { error: "not_found" };
  }

  @Post()
  create(@Body() body: { id?: string; title: string; data?: unknown }): unknown {
    return this.projects.create(body);
  }

  @Put(":id")
  update(@Param("id") id: string, @Body() body: { title?: string; data?: unknown }): unknown {
    return this.projects.update(id, body) ?? { error: "not_found" };
  }

  @Delete(":id")
  delete(@Param("id") id: string): unknown {
    return { deleted: this.projects.delete(id) };
  }
}
