import { Controller, Get, Post, Body, Route, Query } from 'tsoa';
import axios from 'axios';
import runRequest from '../runRequest';
import buildRequest from '../buildRequest';
import { RequestInput } from '../types/requestInput';
import { RequestInputPost, RequestBody } from '../types/requestInputPost';


@Route('')
export class IndexController extends Controller {

  @Get('/search')
  public async search(
    @Query() q?: string,
    @Query() firstName?: string,
    @Query() lastName?: string,
    @Query() birthDate?: string,
    @Query() birthCity?: string,
    @Query() birthDepartment?: string,
    @Query() birthCountry?: string,
    @Query() deathDate?: string,
    @Query() deathCity?: string,
    @Query() deathDepartment?: string,
    @Query() deathCountry?: string,
    @Query() size?: number,
    @Query() page?: number,
    @Query() fuzzy?: string,
    @Query() sort?: string
  ) {
    const requestInput = new RequestInput(q, firstName, lastName, birthDate, birthCity, birthDepartment, birthCountry, deathDate, deathCity, deathDepartment, deathCountry, size, page, fuzzy, sort);
    const requestBuild = buildRequest(requestInput);
    const result = await runRequest(requestBuild);
    return  { msg: result.data };
  }

  @Post('/search')
  public async searchpost(@Body() requestBody: RequestBody) {
    const requestInput = new RequestInputPost(requestBody);
    const requestBuild = buildRequest(requestInput);
    const result = await runRequest(requestBuild);
    return  { msg: result.data };
  }

  @Get('/healthcheck')
  public msg() {
    return { msg: 'OK' };
  }
}
