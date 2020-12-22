import moment from 'moment'
import {
  fullTextWithQuery,
  nameWithQuery,
  sexWithQuery,
  sortWithQuery,
  birthDateWithQuery,
  birthCityWithQuery,
  birthDepartmentWithQuery,
  birthCountryWithQuery,
  birthGeoPointWithQuery,
  deathDateWithQuery,
  deathAgeWithQuery,
  deathCityWithQuery,
  deathDepartmentWithQuery,
  deathCountryWithQuery,
  deathGeoPointWithQuery
} from '../fieldsWithQueries';

import { GeoPoint, RequestField, Sort } from './entities';

export interface Block {
  scope: string[],
  minimum_match: number,
  should?: boolean
}

/**
 * These are all the query parameters
 * @tsoaModel
 * @example
 * {
 *   "firstName": "Georges",
 *   "lastName": "Pompidou",
 *   "sex": "M",
 *   "deathCity": "Paris"
 * }
 */
export interface RequestBody {
 [key: string]: any; // Index signature
 /**
  * Le temps durant lequel le contexte de la requête doit être garde
  */
 scroll?: string;
 /**
  * Identifiant technique du contexte
  */
 scrollId?: string;
 /**
  * Nombre d\'identités retourne par page
  */
 size?: number;
 /**
  * Numéro de page
  */
 page?: number;
 /**
  * Tri sur les colonnes (à préciser sur la structure du champs)
  */
 sort?: string|Sort[];
 /**
  * Simple query
  */
 fullText?: string;
 /**
  * Prénom
  */
 firstName?: string;
 /**
  * Nom de famille
  */
 lastName?: string;
 /**
  * Nom d'usage
  */
 legalName?: string;
 /**
  * Sexe
  */
 sex?: 'M'|'F'|'H';
 /**
  * Date de naissance au format\: JJ/MM/AAAA<br>  <li> Pour une date inconnue les valeurs sont 0000 pour AAAA; 00 pour MM et JJ</li><br> <li> Une recherche par tranche de date est également possible sous la forme: JJ/MM/AAAA - JJ/MM/AAAA</li>
  */
 birthDate?: string|number;
 /**
  * Localité\: de naissance en claire (pour les personnes nées en France ou dans les DOM/TOM/COM)
  */
 birthCity?: string;
 /**
  * Code département du lieu de naissance
  */
 birthDepartment?: string;
 /**
  * Libellé de pays de naissance en clair (pour les personnes nées à l'étranger)
  */
 birthCountry?: string;
 /**
  * Coordonnés GPS du lieu de naissance
  */
 birthGeoPoint?: GeoPoint;
 /**
  * Date de décès au format\: JJ/MM/AAAA. <br> <li> Pour une date inconnue les valeurs sont 0000 pour AAAA; 00 pour MM et JJ</li>.<br> <li> Une recherche par tranche de date est également possible sous la forme: JJ/MM/AAAA - JJ/MM/AAAA</li>
  */
 deathDate?: string|number;
 /**
  * Localité de décès en claire** (pour les personnes nées en France ou dans les DOM/TOM/COM)
  */
 deathCity?: string;
 /**
  * Code département du lieu de décès
  */
 deathDepartment?: string;
 /**
  * Pays du lieu de décès
  */
 deathCountry?: string;
 /**
  * Coordonnés GPS du lieu de décès
  */
 deathGeoPoint?: GeoPoint;
 /**
  * Age du décès
  */
 deathAge?: string|number;
 /**
  * Age du décès
  */
 lastSeenAliveDate?: string;
 /**
  * Langage entête
  */
 headerLang?: string;
};


interface RequestInputParams {
  q?: string;
  firstName?: string;
  lastName?: string;
  legalName?: string;
  sex?: string;
  birthDate?: string|number;
  birthCity?: string;
  birthDepartment?: string;
  birthCountry?: string;
  birthGeoPoint?: GeoPoint;
  deathDate?: string|number;
  deathCity?: string;
  deathDepartment?: string;
  deathCountry?: string;
  deathGeoPoint?: GeoPoint;
  deathAge?: string|number;
  lastSeenAliveDate?: string;
  scroll?: string;
  scrollId?: string;
  size?: number;
  page?: number;
  fuzzy?: string;
  sort?: string|Sort[];
  block?: Block;
  dateFormat?: any;
}

export class RequestInput {
  [key: string]: any; // Index signature
  fullText?: RequestField;
  firstName?: RequestField;
  lastName?: RequestField;
  legalName?: RequestField;
  sex?: RequestField;
  birthDate?: RequestField;
  birthCity?: RequestField;
  birthDepartment?: RequestField;
  birthCountry?: RequestField;
  birthGeoPoint?: RequestField;
  deathDate?: RequestField;
  deathCity?: RequestField;
  deathDepartment?: RequestField;
  deathCountry?: RequestField;
  deathGeoPoint?: RequestField;
  deathAge?: RequestField;
  lastSeenAliveDate?: RequestField;
  id?: string;
  size?: number;
  scroll?: string;
  scrollId?: string;
  page?: number;
  fuzzy?: string;
  sort?: RequestField;
  block?: Block;
  dateFormat?: string;
  metadata?: any;
  errors: string[] = [];
  constructor(params: RequestInputParams) {
    this.size = params.size ? params.size : 20;
    this.page = params.page ? params.page : 1;
    this.scroll = params.scroll ? params.scroll : '';
    this.scrollId = params.scrollId ? params.scrollId : '';
    this.sort = params.sort ? sortWithQuery(params.sort) : {value: [{score: 'desc'}]}
    this.block = params.block;
    this.dateFormat = params.dateFormat;
    const birthDateTransformed = params.birthDate && params.dateFormat ? moment(params.birthDate.toString(), params.dateFormat).format("DD/MM/YYYY"): params.birthDate;
    let deathDateTransformed
    if (params.lastSeenAliveDate) {
      deathDateTransformed = params.dateFormat ? `>${moment(params.lastSeenAliveDate.toString(), params.dateFormat).format("DD/MM/YYYY")}` : `>${params.lastSeenAliveDate}`;
    } else {
      deathDateTransformed = params.deathDate && params.dateFormat ? moment(params.deathDate.toString(), params.dateFormat).format("DD/MM/YYYY") : params.deathDate;
    }

    this.fullText = fullTextWithQuery(params.q, params.fuzzy);
    this.name = nameWithQuery({
      first: params.firstName,
      last: params.lastName
      legal: params.legalName
    }, params.fuzzy);
    this.sex = sexWithQuery(params.sex, params.fuzzy);
    this.birthDate = birthDateWithQuery(birthDateTransformed, params.fuzzy);
    this.birthCity = birthCityWithQuery(params.birthCity, params.fuzzy);
    this.birthDepartment = birthDepartmentWithQuery(params.birthDepartment, params.fuzzy);
    this.birthCountry = birthCountryWithQuery(params.birthCountry, params.fuzzy);
    this.birthGeoPoint = birthGeoPointWithQuery(params.birthGeoPoint, params.fuzzy);
    this.deathDate = deathDateWithQuery(deathDateTransformed, params.fuzzy);
    this.deathAge = deathAgeWithQuery(params.deathAge, params.fuzzy);
    this.deathCity = deathCityWithQuery(params.deathCity, params.fuzzy);
    this.deathDepartment = deathDepartmentWithQuery(params.deathDepartment, params.fuzzy);
    this.deathCountry = deathCountryWithQuery(params.deathCountry, params.fuzzy);
    this.deathGeoPoint = deathGeoPointWithQuery(params.deathGeoPoint, params.fuzzy);

    Object.keys(this).map(field => {
      if (this[field] && this[field].mask && this[field].mask.validation) {
        if (!this[field].mask.validation(this[field].value)) {
          this.errors.push(`invalid ${field} value: ${this[field].value}`);
        }
      }
    });
  }
}
