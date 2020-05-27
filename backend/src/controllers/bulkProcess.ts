import { Job } from 'bullmq';
import { buildRequest } from '../buildRequest';
import { RequestInput } from '../models/requestInput';
import { runBulkRequest } from '../runRequest';
import { buildResultSingle, ResultRawES } from '../models/result';
import { scoreResults } from '../score';


const myProcessor = async (job: Job): Promise<any> => {
  const rows: any = job.data.inputs.file.split(/\s*\r?\n\r?\s*/).map((str: string) => str.split(job.data.sep)); // TODO: parse all the attachements
  delete job.data.inputs;
  const validFields: string[] = ['q', 'firstName', 'lastName', 'sex', 'birthDate', 'birthCity', 'birthDepartment', 'birthCountry',
    'birthGeoPoint', 'deathDate', 'deathCity', 'deathDepartment', 'deathCountry', 'deathGeoPoint', 'deathAge',
    'size', 'fuzzy', 'block'];
  const jsonFields: string[] = ['birthGeoPoint','deathGeoPoint','block']
  const mapField: any = {};
  validFields.map(key => mapField[job.data[key] || key] = key );
  const header: any = {};
  let nFields:any = 0;
  rows.shift().forEach((key: string, idx: number) => {
    header[idx] =  key;
    nFields++;
  });
  let json = [{
    metadata: {
      mapping: mapField,
      header: [...Array(nFields).keys()].map(idx => header[idx])
    }
  }];
  json = json.concat(rows
    .filter((row: string[]) => row.length === nFields)
    .map((row: string[]) => {
      const request: any = {
        metadata: {
          source: {}
        }
      }
      row.forEach((value: string, idx: number) => {
        if (mapField[header[idx]]) {
          request[mapField[header[idx]]] = jsonFields.includes(header[idx]) ? JSON.parse(value) : value;
        }
        request.metadata.source[header[idx]] = value;
      });
      request.block = request.block
        ? request.block
        : job.data.block
        ? JSON.parse(job.data.block)
        : {
          scope: ['name', 'birthDate'],
          'minimum_match': 1
        };
      return request;
    }))
  return processSequential(json, job)

}

const processSequential = async (rows: any, job: Job): Promise<any> => {
  const resultsSeq = []
  const chunk = Number(job.data.chunkSize);
  let temparray: any;
  let i;
  let j;
  for (i=0, j=rows.length; i<j; i+=chunk) {
    temparray = rows.slice(i,i+chunk);
    const bulkRequest = temparray.map((row: any) => { // TODO: type
      const requestInput = new RequestInput(row.q, row.firstName, row.lastName, row.sex, row.birthDate, row.birthCity, row.birthDepartment, row.birthCountry, row.birthGeoPoint, row.deathDate, row.deathCity, row.deathDepartment, row.deathCountry, row.deathGeoPoint, row.deathAge, row.scroll, row.scrollId, row.size, row.page, row.fuzzy, row.sort, row.block);
      return [JSON.stringify({index: "deces"}), JSON.stringify(buildRequest(requestInput))];
    })
    const msearchRequest = bulkRequest.map((x: any) => x.join('\n\r')).join('\n\r') + '\n';
    const result = await runBulkRequest(msearchRequest);
    if (result.data.responses.length > 0) {
      result.data.responses.forEach((item: ResultRawES, idx: number) => {
        if (item.hits.hits.length > 0) {
          const scoredResults = scoreResults(temparray[idx], item.hits.hits.map(hit => buildResultSingle(hit)))
          if (scoredResults && scoredResults.length > 0) {
            resultsSeq.push({...temparray[idx], ...scoredResults[0]})
          } else {
            resultsSeq.push(temparray[idx])
          }
        } else {
          resultsSeq.push(temparray[idx])
        }
      })
    } else {
      resultsSeq.push(temparray)
    }
    job.updateProgress({rows: resultsSeq.length, percentage: resultsSeq.length / rows.length * 100})
  }
  return resultsSeq
};

export default myProcessor;
