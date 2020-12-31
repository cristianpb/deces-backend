import { RequestBody } from './models/requestInput';
import { Person, Location, Name, RequestField, ScoreParams } from './models/entities';
import { distance } from 'fastest-levenshtein';
import damlev from 'damlev';
import jw from 'jaro-winkler';
import fuzz from 'fuzzball';
import moment from 'moment';
import { dateTransformMask, isDateRange } from './masks';
import soundex from '@thejellyfish/soundex-fr';

const perfectScoreThreshold = 0.75;
const multipleMatchPenalty = 1;
const multiplePerfectScorePenalty = 0.1;
const multipleBestScorePenalty = 0.15;
const multipleErrorPenalty = 0.8;
const secondaryCandidatePenaltyPow = 2;
const secondaryCandidateThreshold = 0.4;

const tokenPlacePenalty = 0.7;
const blindTokenScore = 0.5;

const nameInversionPenalty = 0.7;
const fuzzPenalty = 1.5;
const stopNamePenalty = 0.8;
const minNameScore = 0.1;
const blindNameScore = 0.5;
const wrongLastNamePenalty = {
    M: 0.1,
    F: 0.65
}
const lastNamePenalty = 1.5;

const minSexScore = 0.5;
const firstNameSexPenalty = 0.65;
const blindSexScore = 0.99;

const minDateScore = 0.2;
const blindDateScore = 0.8;
const uncertainDateScore = 0.7;
const datePenalty = 3

const minLocationScore = 0.2;
const boroughLocationPenalty = 0.9;
const minDepScore = 0.85;
const minNotFrCityScore = 0.5;
const minNotFrCountryScore = 0.5;
const blindLocationScore = 0.8;

const boostSoundex = 1.5;

const defaultPruneScore = 0.3;

const multyiply = (a:number, b: number): number => a*b;
const max = (a:number, b: number): number => Math.max(a*b);
const sum = (a:number, b: number): number => a+b;
const mean = (table: number[]): number => (table.length ? table.reduce(sum)/table.length : 0);
const round = (s: number): number => parseFloat(s.toFixed(2));

const normalize = (token: string|string[]): string|string[] => {
    if ((token === undefined) || (token === null)) {
        return '';
    }
    if (typeof(token) === 'string') {
        return token.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g,' ').replace(/^\s*$/,'');
    } else {
        return token.map(t => normalize(t) as string);
    }
}

const levRatio = (tokenA: string, tokenB: string, option?: any): number => {
    const lev = option || distance;
    if (!tokenA || !tokenB) { return 0 }
    if (tokenA === tokenB) {
        return 1
    } else {
        if (tokenA.length < tokenB.length) {
            return levRatio(tokenB, tokenA, option)
        }
        return round((1 - (lev(tokenA, tokenB) / tokenA.length)));
    }
}

const fuzzyRatio = (tokenA: string, tokenB: string, option?: any): number => {
    const compare = option || levRatio;
    if (!tokenA || !tokenB) {
        return 0;
    }
    const a:string = normalize(tokenA) as string;
    const b:string = normalize(tokenB) as string;
    if (a === b) {return 1}
    let s = compare(a, b);
    if (s === 1) { return 1}
    if (! option) {
        s = s ** ((soundex(a) === soundex(b)) ? (1/boostSoundex) : boostSoundex );
    }
    return round(s);
};

const fuzzballPartialTokenSortRatio = (a: string, b: string) => {
    return 0.01 * fuzz.token_sort_ratio(a,b);
}

const fuzzballTokenSetRatio = (a: string, b: string) => {
    return 0.01 * fuzz.token_set_ratio(a,b);
}

const fuzzballRatio = (a: string, b: string) => {
    return 0.01 * fuzz.ratio(a,b);
}

const fuzzMixRatio = (a: string, b: string) => {
    if (Array.isArray(tokenize(a)) || Array.isArray(tokenize(b))) {
        return 0.01 * fuzz.token_set_ratio(a,b);
    } else {
        return levRatio(a,b);
    }
}

const applyRegex = (a: string|string[], reTable: any): string|string[] => {
    if (typeof(a) === 'string') {
        let b = normalize(a) as string;
        reTable.map((r:any) => b = b.replace(r[0], r[1]));
        return b;
    } else {
        return a.map(c => applyRegex(c, reTable) as string);
    }
}

const tokenize = (sentence: string|string[], tokenizeArray?: boolean): string|string[] => {
    if (typeof(sentence) === 'string') {
        const s = sentence.split(/,\s*|\s+/);
        return s.length === 1 ? s[0] : s ;
    } else {
        if (tokenizeArray) {
            return ((sentence as string[]).map(s => tokenize(s)) as any).flat();
        } else {
            // default dont tokenize if string[]
            return sentence as string[];
        }

    }
}

const scoreReduce = (score:any, multiplePenalty?: boolean ):number => {
    if (!score) {
        return 0;
    }
    if (score.score) {
        return round(score.score);
    } else {
        const r:any = Object.keys(score).map(k => {
            if (typeof(score[k]) === 'number') {
                return  round(score[k]);
            } else {
                return  round(score[k].score) || scoreReduce(score[k], multiplePenalty);
            }
        });
        return r.length ?
            (round(r.reduce(multyiply) ** (multiplePenalty ?
                ( multipleErrorPenalty * ( 2 - (r.filter((s: number) => s >= perfectScoreThreshold).length)/r.length))
                : 1 )))
            : 0;
    }
}

export const scoreResults = (request: RequestBody, results: Person[], params: ScoreParams): Person[] => {
    const pruneScore = params.pruneScore !== undefined ? params.pruneScore : defaultPruneScore
    const candidateNumber = params.candidateNumber || 1;
    let maxScore = 0;
    let perfectScoreNumber = 0;
    let perfectNameScore = false;
    let bestScoreNumber = 0;
    let filteredResultsNumber = 0;
    // following count of meaning arguments (sex not taken as such) used to reduce penalty of blind scoring penalties
    const requestMeaningArgsNumber = ((request.fullText || request.lastName || request.firstName || request.lastName) ? 1 : 0)
        + (request.birthDate ? 1 : 0)
        + ((request.birthCity || request.birthCountry || request.birthDepartment || request.birthGeoPoint) ? 1 : 0)
    const resultsWithScores: any = results
            .filter((result:any) => result.score > 0)
            .map((result:any) => {
                try {
                    result.scores = new ScoreResult(request, result, params);
                    result.scores.score =  round(scoreReduce(result.scores, true) ** (requestMeaningArgsNumber/(Object.keys(result.scores).length || 1)));
                } catch(err) {
                    result.scores = {};
                }
                result.scores.es = round(0.005 * Math.min(200, result.score));
                result.score = (result.scores.score !== undefined) ?  round(result.scores.score) : result.scores.es;
                if (result.score > maxScore) { maxScore = result.score }
                if (result.score >= perfectScoreThreshold) { perfectScoreNumber++ }
                if ((result.sex && (result.sex === 'F')) && (result.scores && result.scores.name && (result.scores.name.score > wrongLastNamePenalty.F))) { perfectNameScore = true; }
                return result;
            })
            .filter((result: any) => result.score >= pruneScore)
            .map((result: any) => {
                if (result.score === maxScore) { bestScoreNumber++; }
                if (result.sex && (result.sex === 'M') || !perfectNameScore || (result.scores && result.scores.name && result.scores.name.score > wrongLastNamePenalty.F)) {
                    filteredResultsNumber++;
                }
                return result;
            })
            .sort((a: any, b: any) => (a.score < b.score) ? 1 : ( (a.score > b.score) ? -1 : 0 ))
            .map((result: any) => {
                if (perfectNameScore && filteredResultsNumber &&
                    result.scores && result.scores.name && (result.scores.name.score <= wrongLastNamePenalty.F)) {
                    // filter alteratives with wrong last name if a good one is present in results list
                        result.score = 0;
                }
                if (result.score > 0) {
                    if (filteredResultsNumber > 1) {
                        if (perfectScoreNumber > 0) {
                            if (result.score < perfectScoreThreshold) {
                                result.score = round((
                                    (1 - multiplePerfectScorePenalty * (perfectScoreNumber - 1 + multipleMatchPenalty*(filteredResultsNumber - perfectScoreNumber)/candidateNumber)) * result.score ** (secondaryCandidatePenaltyPow + (filteredResultsNumber - perfectScoreNumber))
                                ));
                            } else {
                                result.score = round(
                                    (1 - multiplePerfectScorePenalty * (perfectScoreNumber - 1 + multipleMatchPenalty*(filteredResultsNumber - perfectScoreNumber)/candidateNumber)) * result.score ** (result.score < maxScore ? secondaryCandidatePenaltyPow : 1)
                                );
                                result.scores.multiMatchPenalty = round(result.score / (result.scores.score || 1));
                                result.scores.multiMatch = filteredResultsNumber;
                                result.scores.score = result.score;
                            }
                        } else {
                                result.score = round((
                                    (1 - multipleBestScorePenalty * (bestScoreNumber - 1 + multipleMatchPenalty*(filteredResultsNumber - bestScoreNumber)/candidateNumber)) * result.score ** (result.score < maxScore ? secondaryCandidatePenaltyPow + (filteredResultsNumber - bestScoreNumber) : 1)
                                ));
                                result.scores.multiMatchPenalty = round(result.score / (result.scores.score || 1));
                                result.scores.multiMatch = filteredResultsNumber;
                                result.scores.score = result.score;
                        }
                    }
                    if ((result.score < maxScore) && (result.score < secondaryCandidateThreshold)) {
                        result.score = 0;
                    }
                }
                return result;
            })
            .filter((result: any) => result.score >= pruneScore);
    return resultsWithScores;
}

export class ScoreResult {
  score: number;
  date?: number
  name?: number;
  sex?: number;
  location?: number;

  constructor(request: RequestBody, result: Person, params: ScoreParams = {}) {
    const pruneScore = params.pruneScore !== undefined ? params.pruneScore : defaultPruneScore
    if (request.birthDate) {
      this.date = scoreDate(request.birthDate, result.birth.date, params.dateFormat,
        result.birth && result.birth.location && result.birth.location.countryCode && (result.birth.location.countryCode !== 'FRA')
        );
    }
    if (request.firstName || request.lastName) {
      if ((pruneScore < scoreReduce(this, true)) || !this.date) {
        if (result.sex && result.sex === 'F') {
            if (request.legalName) {
                this.name = scoreName({first: request.firstName, last: [request.lastName, request.legalName]}, result.name, 'F');
            } else {
                this.name = scoreName({first: request.firstName, last: request.lastName}, result.name, 'F');
            }
        } else {
          this.name = scoreName({first: request.firstName, last: request.lastName}, result.name, 'M');
        }
      } else {
        this.score = 0
      }
    }
    if (request.sex) {
      if (pruneScore < scoreReduce(this, true)) {
        this.sex = scoreSex(request.sex, result.sex);
      } else {
        this.score = 0
      }
    } else if (request.firstName && firstNameSexMismatch(request.firstName, result.name.first as string)) {
        this.sex = firstNameSexPenalty;
    }
    // location
    if (pruneScore < scoreReduce(this, true)) {
    this.location = scoreLocation({
        city: request.birthCity,
        cityCode: request.birthCityCode,
        departmentCode: request.birthDepartment,
        country: request.birthCountry,
        latitude: request.latitude,
        longitude: request.longitude
    }, result.birth.location);
    } else {
    this.score = 0
    }
    if (!this.score) {
      this.score = scoreReduce(this, true)
    }
  }
}

const firstNameRegExp = [[/^(inconnu|spc?|sans prenom( connu)?|X+)$/,'']]

const firstNameNorm = (name: string|string[]): string|string[] => {
    return tokenize(applyRegex(name, firstNameRegExp), true);
}

const lastNameRegExp = [
    [/^(mr|mme|mlle|monsieur|madame|mademoiselle)\s+/,''],
    [/^(inconnu|snc?|sans nom( connu)?|X+)$/,'']
]

const lastNameNorm = (name: string|string[]): string|string[] => {
    return applyRegex(name, lastNameRegExp);
}

export const stopNames = [
    [/(^|\s)de (los|la)\s+/,'$1'],
    [/(^|\s)(baron|marquis|duc|vicomte|prince|chevalier)\s+/,'$1'],
    [/(^|\s)(ait|ben|du|de|l|d|dos|del|le|el)\s+/, '$1'],
    [/\s+(du|de la|des|de|le|aux|de los|del|l|d)\s+/,' '],
    [/(^|\s)st\s+/, '$1saint ']
];

const filterStopNames = (name: string|string[]): string|string[] => {
    return applyRegex(name, stopNames);
}

const firstNameSexMismatch = (firstNameA: string, firstNameB: string): boolean => {
    let firstA = firstNameNorm(firstNameA);
    firstA = typeof(firstA) === 'string' ? firstA : (firstA as string[])[0];
    let firstB = firstNameNorm(firstNameB);
    firstB = typeof(firstB) === 'string' ? firstB : (firstB as string[])[0];
    return /^.?(e|a)$/.test(firstA.replace(firstB, '')) || /^.?(e|a)$/.test(firstB.replace(firstA, ''));
}

const scoreName = (nameA: Name, nameB: Name, sex: string): any => {
    if ((!nameA.first && !nameA.last) || (!nameB.first && !nameB.last)) { return blindNameScore }
    let score:any;
    const firstA = firstNameNorm(nameA.first as string|string[]);
    const lastA = lastNameNorm(nameA.last as string|string[]);
    const firstB = firstNameNorm(nameB.first as string|string[]);
    const lastB = lastNameNorm(nameB.last as string|string[]);
    const lastAtokens = tokenize(lastA);
    const lastBtokens = tokenize(lastB);
    // reduce lastNamePenalty for long names
    const thisLastNamePenalty = ((Array.isArray(lastAtokens) && (lastAtokens.length > 2)) ||
        (Array.isArray(lastBtokens) && (lastBtokens.length > 2))) ? 1 : lastNamePenalty;
    let firstFirstA, firstFirstB, scoreFirstALastB, fuzzScore;
    const scoreFirst = round(scoreToken(firstA, firstB as string|string[]));
    const scoreLast = round(scoreToken(lastA, lastB));
    score = round(Math.max(
                scoreFirst * (scoreLast ** thisLastNamePenalty),
                Math.max(
                    /* missing first name */
                    (!nameA.first || !nameB.last) ? (scoreLast ** thisLastNamePenalty) * (blindNameScore ** 2): 0,
                    /* wrong last name, give a chance for legal Name */
                    scoreFirst * wrongLastNamePenalty[sex as 'F'|'M']
                )
            ),
          );
    if (score < blindNameScore) {
        if ( ((scoreFirst >= blindNameScore) || (scoreLast >= blindNameScore))
            && (Array.isArray(lastAtokens) || Array.isArray(lastBtokens)) && (Array.isArray(firstA) || Array.isArray(firstB)) ) {
            // backoff to fuzzball set ratio for complex names situations
            const partA = filterStopNames(lastA.toString()+" "+firstA.toString());
            const partB = filterStopNames(lastB.toString()+" "+firstB.toString());
            fuzzScore = round((tokenPlacePenalty * fuzzyRatio(partA as string, partB as string , fuzzballPartialTokenSortRatio) ** fuzzPenalty)
            );
            if (fuzzScore > blindNameScore) {
                score = Math.max(
                    score,
                    fuzzScore
                );
            }
        }
        // first / last name inversion
        firstFirstA = Array.isArray(firstA) ? firstA[0] : firstA ;
        scoreFirstALastB = scoreToken(firstFirstA as string, lastB as string);
        if (scoreFirstALastB >= blindNameScore) {
            firstFirstB = Array.isArray(firstB) ? firstB[0] : firstB ;
            score = Math.max(
                score,
                Math.max(
                    minNameScore,
                    nameInversionPenalty * (scoreFirstALastB ** thisLastNamePenalty) * scoreToken(lastA, firstFirstB as string) ** thisLastNamePenalty
                )
            );
        }
    }
    score = { score, first: scoreFirst, last: scoreLast };
    if (fuzzScore) { score.fuzz = fuzzScore}
    if (score.score === 1) return score;

    // give a chance to particle names
    const lastStopA = filterStopNames(lastA);
    const lastStopB = filterStopNames(lastB);

    if ((lastA !== lastStopA) && (lastB !== lastStopB)) {
        let particleScore = stopNamePenalty * (round(scoreFirst * (scoreToken(lastStopA, lastStopB as string) ** thisLastNamePenalty)));
        if (particleScore < blindNameScore) {
            firstFirstA = firstFirstA || (Array.isArray(firstA) ? firstA[0] : firstA);
            scoreFirstALastB = scoreToken(firstFirstA, lastStopB as string);
            if (scoreFirstALastB >= blindNameScore) {
                firstFirstB = firstFirstB || (Array.isArray(firstB) ? firstB[0] : firstB);
                particleScore = Math.max(
                    particleScore,
                    stopNamePenalty * (round(nameInversionPenalty * (scoreFirstALastB ** thisLastNamePenalty) * scoreToken(lastStopB, firstFirstB as string|string[]) ** thisLastNamePenalty
                    )));
            }
        }
        if (particleScore > score.score) {
            score.score = particleScore;
            score.particleScore = particleScore;
        }
    }
    return score;
}

const scoreToken = (tokenA: string|string[], tokenB: string|string[], option?: any): number => {
    let s:number;
    try {
        if (!tokenA || !tokenB) {
            s = blindTokenScore;
        } else {
            if (typeof(tokenA) === 'string') {
                if (typeof(tokenB) === 'string') {
                    if (tokenA === tokenB) {
                        s = 1;
                    } else {
                        s = fuzzyRatio(tokenA, tokenB, option);
                    }
                } else {
                    s = Math.max(
                        fuzzyRatio(tokenA, tokenB[0], option),
                        ( tokenB.length > 1 )
                            ? tokenPlacePenalty * tokenB.slice(1, tokenB.length).map(token => fuzzyRatio(tokenA, token, option)).reduce(max) : 0
                    );
                }
            } else {
                if (typeof(tokenB) === 'string') {
                    s = scoreToken(tokenB, tokenA as string|string[], option);
                } else {
                    // if both tokenA and tokenB are arrays
                    // compare field by field, first field error lead to greater penalty (cf ** (1/(i+1)))
                    const min = blindNameScore;
                    let previous = 0;
                    s = mean((tokenA as string[]).filter((token,i) => (i<tokenB.length))
                        .map((token, i) => {
                        const current = fuzzyRatio(token, tokenB[i],option);
                        previous = previous ? 0.5*(previous + current) : current;
                        return previous;
                    }))
                }
            }
        }
    } catch(err) {
        s = 0;
    }
    return s;
}

const cityRegExp = [
    [ /^\s*(lyon|marseille|paris)(\s.*|\s*\d\d*.*|.*art.*|.*arr.*)$/, '$1'],
    [ /(^|\s)ste(\s|$)/, '$1sainte$2'],
    [ /(^|\s)st(\s|$)/, '$1saint$2'],
    [ /^aix pce$/, 'aix provence'],
    [ /(^|\s)(de|en|les|le|la|a|aux|au|du|de la|sous|ss?|sur|l|d|des)\s/g, ' '],
    [ /(^|\s)(de|en|les|le|la|a|aux|au|du|de la|sous|ss?|sur|l|d|des)\s/g, ' '],
    [ /^x$:/, ''],
    [ /\s+/, ' '],
    [ /œ/, 'oe'],
    [ /æ/, 'ae'],
    [ /^.*inconnu.*$/, ''],
    [ /sainte clotilde/, 'saint denis'],
    [ /berck mer/, 'berck'],
    [ /montreuil s.* bois/, 'montreuil'],
    [ /asnieres s.* seine/, 'asnieres'],
    [ /clichy garenne.*/, 'clichy'],
    [ /belleville saone/, 'belleville'],
    [ /^levallois$/, 'levallois perret'],
    [ /'\s$/, ''],
    [ /^\s*/, '']
];

const cityNorm = (city: string|string[]): string|string[] => {
    return applyRegex(city, cityRegExp);
}

const scoreCity = (cityA: string|string[]|RequestField, cityB: string|string[]): number => {
    if (typeof(cityA) === 'string') {
        const cityNormA = cityNorm(cityA) as string;
        const cityNormB = cityNorm(cityB);
        let score;
        if (typeof(cityNormB) === 'string') {
            score = fuzzyRatio(cityNormA, cityNormB, fuzzMixRatio);
        } else {
            score = Math.max(...cityNormB.map(city => fuzzyRatio(cityNormA, city, fuzzMixRatio)));
        }
        if ((score === 1) && Array.isArray(cityNormB) && cityNormB[0] === 'paris') {
            const boroughA = extractboroughNumber(cityA);
            if (boroughA && (boroughA !== extractboroughNumber(cityB[1]))) {
                return boroughLocationPenalty;
            }
        }
        return score;
    } else {
        const cityNormB = cityNorm(cityB);
        return Math.max(...(cityA as string[]).map(city => scoreCity(cityNorm(city), cityNormB)));
    }
}

const boroughRegExp = [[/^\D*0*([1-9]+0?)\D*$/, '$1']];

const extractboroughNumber = (city: string): string => {
    const borough = applyRegex(city, boroughRegExp);
    if (borough !== normalize(city)) { return borough as string; }
    return undefined;
}

const depCodeRexExp = [
    [/^0?2[ab]$/,'20'],
    [/^0*([1-9]+0?)$/, '$1'],
    [/^(\D*|99|0)$/,'']
];

const scoreDepCode = (depCodeA: string|string[]|RequestField, depCodeB: string|RequestField, sameCity: boolean ) => {
    const normDepCodeA = applyRegex(depCodeA as string|string[], depCodeRexExp);
    const normDepCodeB = applyRegex(depCodeB as string|string[], depCodeRexExp);
    if (!normDepCodeA || !normDepCodeB) {
        return undefined;
    }
    if (normDepCodeA === normDepCodeB) {
        return 1;
    } else {
        if (sameCity && (['75','78'].indexOf(normDepCodeB as string) >=0) && (['78','91','92','93','94','95'].indexOf(normDepCodeA as string) >=0)) {
            return 1;
        } else {
            if (normDepCodeA === '97') {
                return round((3+minDepScore)/4);
            } else {
                return minDepScore;
            }
        }
    }
}

const countryRegExp = [
    [ /(^|\s)(de|en|les|le|la|a|aux|au|du|de la|s|sous|sur|l|d|des)\s/g, ' '],
    [ /hollande/, 'pays-bas'],
    [ /(angleterre|grande bretagne)/, 'royaume-uni'],
    [ /(vietnam)/, 'viet nam']
];

const countryNorm = (country: string|string[]): string|string[] => {
    return applyRegex(country, countryRegExp);
}

const scoreCountry = (countryA: string|string[]|RequestField, countryB: string|string[]): number => {
    if (typeof(countryA) === 'string') {
        const countryNormA = countryNorm(countryA) as string;
        if (typeof(countryB) === 'string') {
            return fuzzyRatio(countryNormA, countryNorm(countryB) as string, fuzzSetRatio);
        } else {
            return Math.max(...countryB.map(country => fuzzyRatio(countryNormA, countryNorm(country) as string, fuzzSetRatio)),
                fuzzSetRatio(countryNormA, countryB.join(' '))
                );
        }
    } else {
        const countryNormB = countryNorm(countryB);
        return Math.max(...(countryA as string[]).map(country => scoreCountry(countryNorm(country), countryNormB)),
            fuzzSetRatio((countryA as string[]).join(' '), Array.isArray(countryNormB) ? countryNormB.join(' ') : countryNormB)
        );
    }
}


const scoreLocation = (locA: Location, locB: Location): any => {
    const score: any = {};
    const BisFrench = locB.country && (locB.countryCode === 'FRA');
    if (BisFrench) {
        if (normalize(locA.country as string|string[])) {
            score.country = scoreCountry(locA.country, tokenize(locB.country as string) as string|string[]);
        }
        if (normalize(locA.city as string|string[]) && locB.city) {
            score.city = scoreCity(locA.city, locB.city as string|string[]);
        }
        if (normalize(locA.departmentCode as string|string[]) && locB.departmentCode) {
            if (BisFrench) {
                if (locA.departmentCode !== '99') {
                score.department = (locA.departmentCode === locB.departmentCode) ? 1 :
                    ( ( (score.city === 1) && (locB.departmentCode === '75') && (['78','91','92','93','94','95'].indexOf(locA.departmentCode as string)) ) ? 1 : minDepScore);
                } else {
                    score.country = minLocationScore;
                }
            }
        }
        score.score = (score.country || score.city || score.department) ? Math.max(minLocationScore, scoreReduce(score)) : blindLocationScore;
    } else {
        if (normalize(locA.country as string|string[])) {
            score.country = scoreCountry(locA.country, tokenize(locB.country as string) as string|string[]);
        } else {
            if (normalize(locA.city as string|string[])) {
                const sCountry = scoreCountry(locA.city, tokenize(locB.country as string) as string|string[]);
                if (sCountry > minNotFrCountryScore) {
                    score.country = sCountry;
                }
            } else {
                score.country = blindLocationScore;
            }
        }
        if (normalize(locA.city as string|string[]) && locB.city) {
            const sCity = scoreCity(locA.city, tokenize(locB.city) as string|string[]);
            if (sCity > minNotFrCityScore) { score.city = sCity; }
        }
        score.score = Math.max(minNotFrCountryScore, score.country, scoreReduce(score));
    }
    return score;
}

const scoreDate = (dateRangeA: any, dateStringB: string, dateFormat: string, foreignDate: boolean): number => {
  if (dateFormat) {
    dateRangeA = moment(dateRangeA.toString(), dateFormat).format("YYYYMMDD");
  }
  return 0.01 * Math.round((scoreDateRaw(dateRangeA, dateStringB, foreignDate) ** datePenalty) * 100);
}

const scoreDateRaw = (dateRangeA: any, dateStringB: string, foreignDate: boolean): number => {
    if (/^00000000$/.test(dateStringB) || !dateStringB || !dateRangeA) {
        return blindDateScore;
    }
    if (typeof(dateRangeA) === 'string') {
        if (/^\s*$/.test(dateRangeA)) {
            return blindDateScore;
        }
        if (isDateRange(dateRangeA)) {
            const dateArrayA = dateRangeA.split(/-/);
            if (dateArrayA[0] === dateArrayA[1]) {
                return scoreDateRaw(dateArrayA[0], dateStringB, foreignDate);
            }
            return ((dateArrayA[0] <= dateStringB) && (dateArrayA[2] >= dateStringB))
                ? uncertainDateScore
                : (/(^0000|0000$)/.test(dateStringB) ? uncertainDateScore : minDateScore);
        } else {
            if (dateStringB.startsWith("0000")) {
                return round(uncertainDateScore * levRatio(dateTransformMask(dateRangeA).substring(4,8),dateStringB.substring(4,8), damlev));
            }
            if (dateStringB.endsWith("0000")) {
                return round(uncertainDateScore * levRatio(dateTransformMask(dateRangeA).substring(0,4),dateStringB.substring(0,4), damlev));
            }
            if (foreignDate && dateStringB.endsWith("0101") && (dateStringB.substring(0,4) < "1990")
                && dateTransformMask(dateRangeA).endsWith("0101")) {
                // old foreign birth date place to 1st of january are often uncertain dates, leading to lot of confusion
                return round(uncertainDateScore * levRatio(dateTransformMask(dateRangeA).substring(0,4),dateStringB.substring(0,4), damlev));
            }
            return levRatio(dateTransformMask(dateRangeA), dateStringB, damlev);
        }
    } else {
        return blindDateScore;
    }
};


const scoreSex = (sexA: any, sexB: string): number => {
    return (sexA && sexB)
            ? ((sexA.replace(/^(H).*$/,'M') === sexB) ? 1 : minSexScore)
            : blindSexScore;
}

const scoreGeo = (latA: number, lonA: number, latB: number, lonB: number): number => {
    return 0.01*Math.round(
        Math.max(0, 100/(100 + geoDistance(latA, lonA, latB, lonB)))
    )
};

const geoDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
	if ((lat1 === lat2) && (lon1 === lon2)) {
		return 0;
	}
	else {
		const radlat1 = Math.PI * lat1/180;
		const radlat2 = Math.PI * lat2/180;
		const theta = lon1-lon2;
		const radtheta = Math.PI * theta/180;
		let dist = Math.sin(radlat1) * Math.sin(radlat2) + Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta);
		if (dist > 1) {
			dist = 1;
		}
		dist = Math.acos(dist) * 6370.693486;
		return dist;
	}
}
