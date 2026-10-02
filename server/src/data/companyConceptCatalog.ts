import { COMPANY_LABELS } from '../services/companyQuestions.service';
import { slugifyCompanyName } from '../services/companyQuestionBank';
import type { ConceptTier } from '../models/QuestionConcept';

export const COMPANY_GENRES = [
  'product_tech',
  'it_services',
  'strategy_consulting',
  'fintech',
  'core_engineering',
] as const;

export type CompanyGenre = (typeof COMPANY_GENRES)[number];

export const GENRE_LABELS: Record<CompanyGenre, string> = {
  product_tech: 'Product-based Tech',
  it_services: 'IT Services / Consulting',
  strategy_consulting: 'Strategy Consulting (MBB-style)',
  fintech: 'Fintech & Banking',
  core_engineering: 'Core Engineering / Manufacturing',
};

/** Pure strategy firms — case interviews, not IT staffing or software coding screens. */
export const STRATEGY_CONSULTING_SLUGS = new Set([
  'mckinsey-and-company',
  'bain-and-company',
]);

export type CompanyCatalogEntry = {
  slug: string;
  label: string;
  genre: CompanyGenre;
  tier: ConceptTier;
  tierIsGuess: boolean;
};

const HIGH_TIER_SLUGS = new Set([
  'amazon', 'google', 'apple', 'meta', 'microsoft', 'nvidia', 'salesforce', 'adobe',
  'oracle', 'sap', 'ibm', 'intel', 'amd', 'qualcomm', 'cisco', 'paypal', 'uber',
  'flipkart', 'phonepe', 'razorpay', 'swiggy', 'zomato', 'tcs', 'infosys', 'wipro',
  'hcltech', 'accenture', 'deloitte', 'capgemini', 'cognizant', 'tech-mahindra',
  'ltimindtree', 'jpmorgan-chase', 'goldman-sachs', 'morgan-stanley', 'visa',
  'mastercard', 'american-express', 'wells-fargo', 'barclays', 'hsbc',
  'mckinsey-and-company', 'bain-and-company', 'kpmg', 'ey', 'pwc',
  'snowflake', 'servicenow', 'atlassian', 'freshworks', 'zoho',
  'palo-alto-networks', 'crowdstrike', 'cloudflare', 'netflix', 'booking-com',
]);

const MEDIUM_TIER_SLUGS = new Set([
  'persistent-systems', 'mphasis', 'hexaware-technologies', 'coforge', 'ust',
  'brillio', 'nagarro', 'happiest-minds', 'genpact', 'ntt-data', 'cgi', 'unisys',
  'virtusa', 'hcl', 'globallogic', 'hitachi-solutions', 'red-hat', 'vmware',
  'intuit', 'nutanix', 'rubrik', 'cohesity', 'cloudera', 'informatica',
  'fiserv', 'fis', 'fidelity-investments', 'blackrock', 'deutsche-bank',
  'standard-chartered', 'natwest-group', 'state-street', 'bny', 'optum',
  'medtronic', 'siemens', 'honeywell', 'philips', 'bosch-global-software-technologies',
  'schneider-electric', 'ge-healthcare', 'ericsson', 'nokia', 'tata-elxsi',
  'l-and-t-technology-services-ltts', 'kpit-technologies', 'cyient',
  'synopsys', 'cadence', 'western-digital', 'micron-technology', 'juniper-networks',
  'meesho', 'cred', 'ola', 'inmobi', 'expedia-group', 'agoda', 'deloitte-usi',
  'ey-gds', 'pwc-india', 'kpmg-india', 'value-labs', 'marlabs', 'zensar',
]);

const GENRE_BY_CATEGORY: Record<string, CompanyGenre> = {
  finance: 'fintech',
  consulting: 'it_services',
  embedded: 'core_engineering',
  healthcare: 'core_engineering',
  enterpriseSaas: 'product_tech',
  cybersecurity: 'product_tech',
  industrial: 'core_engineering',
  consumer: 'product_tech',
};

const CATEGORY_COMPANY_SLUGS: Record<string, string[]> = {
  finance: [
    'jpmorgan-chase', 'ubs', 'bank-of-america', 'arcesium', 'highradius', 'ascensus',
    'goldman-sachs', 'morgan-stanley', 'american-express', 'visa', 'mastercard',
    'oracle-financial-services-software-ofss', 'paypal', 'razorpay', 'cred', 'fiserv',
    'fis', 'fidelity-investments', 'factset', 'broadridge', 'blackrock', 'bny',
    'state-street', 'barclays', 'hsbc', 'standard-chartered', 'natwest-group',
    'deutsche-bank', 'societe-generale', 'wells-fargo', 'northern-trust',
  ],
  consulting: [
    'deloitte', 'accenture', 'trianz', 'axtria', 'genpact', 'mckinsey-and-company',
    'bain-and-company', 'kpmg', 'ey', 'pwc', 'grant-thornton', 'rsm', 'deloitte-usi',
    'ey-gds', 'pwc-india', 'kpmg-india', 'tcs', 'infosys', 'wipro', 'hcltech',
    'cognizant', 'capgemini', 'tech-mahindra', 'ltimindtree', 'mphasis',
    'persistent-systems', 'hexaware-technologies', 'sonata-software', 'birlasoft',
  ],
  embedded: [
    'nxp-semiconductors', 'nvidia', 'intel', 'amd', 'qualcomm', 'cisco', 'synopsys',
    'cadence', 'western-digital', 'micron-technology', 'juniper-networks',
    'samsung-r-and-d-institute-india', 'lg-soft-india', 'smartplay-technologies',
    'lantronix-india',
  ],
  healthcare: [
    'parexel', 'thryve-digital', 'medtronic', 'sagility-india-hgs-healthcare',
    'siemens-healthineers', 'ge-healthcare', 'citiustech', 'optum', 'unitedhealth-group',
    'cerner-oracle-health', 'epic-systems', 'astrazeneca', 'novartis', 'roche',
    'pfizer', 'eli-lilly', 'sanofi', 'dr-reddy-s-laboratories', 'biocon', 'iqvia',
  ],
  enterpriseSaas: [
    'sap', 'sap-labs-india', 'opentext', 'oracle', 'adp', 'realpage', 'salesforce',
    'celigo', 'tibco-software-india', 'microsoft', 'adobe', 'vmware', 'servicenow',
    'atlassian', 'zoho', 'freshworks', 'intuit', 'informatica', 'nutanix', 'rubrik',
    'cohesity', 'cloudera', 'snowflake', 'red-hat', 'newgen-software', 'smartdocs-technologies',
  ],
  cybersecurity: [
    'palo-alto-networks', 'crowdstrike', 'check-point-software-technologies', 'fortinet',
    'cloudflare', 'rsa',
  ],
  industrial: [
    'carrier-technologies', 'cdk-global', 'abb', 'collins-aerospace', 'siemens',
    'honeywell', 'philips', 'bosch-global-software-technologies', 'schneider-electric',
    'ericsson', 'ericsson-india', 'nokia', 'harman', 'continental', 'aptiv', 'volvo-group',
    'mercedes-benz-research-and-development-india',
    'renault-nissan-technology-and-business-centre-india',
    'tata-elxsi', 'l-and-t-technology-services-ltts', 'kpit-technologies', 'cyient',
    'johnson-controls', 'shell', 'bp', 'exxonmobil', 'shell-info-technologies',
  ],
  consumer: [
    'amazon', 'apple', 'meta', 'google', 'walmart-global-tech', 'flipkart', 'meesho',
    'phonepe', 'swiggy', 'zomato', 'ola', 'uber', 'inmobi', 'expedia-group', 'agoda',
    'booking-com', 'pepsico-global-business-services', 'unilever', 'procter-and-gamble-p-and-g',
    'reckitt', 'mondelez-international', 'pepsico',
  ],
};

const slugToGenre = new Map<string, CompanyGenre>();
Object.entries(CATEGORY_COMPANY_SLUGS).forEach(([category, slugs]) => {
  const genre = GENRE_BY_CATEGORY[category] ?? 'it_services';
  slugs.forEach((slug) => slugToGenre.set(slug, genre));
});
STRATEGY_CONSULTING_SLUGS.forEach((slug) => slugToGenre.set(slug, 'strategy_consulting'));

const assignTier = (slug: string): { tier: ConceptTier; tierIsGuess: boolean } => {
  if (HIGH_TIER_SLUGS.has(slug)) return { tier: 'high', tierIsGuess: false };
  if (MEDIUM_TIER_SLUGS.has(slug)) return { tier: 'medium', tierIsGuess: false };
  if (['microsoft', 'google', 'amazon', 'apple', 'meta'].includes(slug)) {
    return { tier: 'high', tierIsGuess: false };
  }
  const label = COMPANY_LABELS[slug] ?? slug;
  if (/technologies|solutions|systems|software|digital|services|global|tech/i.test(label) && label.length > 28) {
    return { tier: 'low', tierIsGuess: true };
  }
  if (slugToGenre.has(slug)) return { tier: 'medium', tierIsGuess: true };
  return { tier: 'low', tierIsGuess: true };
};

const buildEntry = (slug: string): CompanyCatalogEntry => {
  const { tier, tierIsGuess } = assignTier(slug);
  return {
    slug,
    label: COMPANY_LABELS[slug] ?? slug,
    genre: slugToGenre.get(slug) ?? 'it_services',
    tier,
    tierIsGuess,
  };
};

export const COMPANY_CATALOG: CompanyCatalogEntry[] = Object.keys(COMPANY_LABELS)
  .map(buildEntry)
  .sort((left, right) => {
    const tierOrder = { high: 0, medium: 1, low: 2 };
    const td = tierOrder[left.tier] - tierOrder[right.tier];
    if (td !== 0) return td;
    return left.label.localeCompare(right.label);
  });

/** Pilot batch: one company per genre at varied tiers for manual QA. */
export const PILOT_BATCH_SLUGS = [
  'amazon',
  'tcs',
  'razorpay',
  'siemens',
  'pennant-technologies',
] as const;

export const getCatalogCompanies = (options: {
  scope: 'pilot' | 'full' | 'custom';
  slugs?: string[];
  limit?: number;
}): CompanyCatalogEntry[] => {
  if (options.scope === 'pilot') {
    return PILOT_BATCH_SLUGS.map((slug) => getCatalogEntry(slug)).filter(Boolean) as CompanyCatalogEntry[];
  }
  if (options.scope === 'custom' && options.slugs?.length) {
    return options.slugs
      .map((slug) => getCatalogEntry(slug))
      .filter(Boolean) as CompanyCatalogEntry[];
  }
  const limit = options.limit ?? 100;
  const pilotSlugs = new Set<string>(PILOT_BATCH_SLUGS);
  return COMPANY_CATALOG.filter((entry) => !pilotSlugs.has(entry.slug)).slice(0, limit);
};

export const getCatalogEntry = (slug: string) =>
  COMPANY_CATALOG.find((entry) => entry.slug === slugifyCompanyName(slug));

export const getCompaniesByGenre = (genre: CompanyGenre) =>
  COMPANY_CATALOG.filter((entry) => entry.genre === genre);

export const tierConceptTarget = (tier: ConceptTier) => {
  if (tier === 'high') return { min: 25, max: 30, target: 28 };
  if (tier === 'medium') return { min: 15, max: 20, target: 18 };
  return { min: 8, max: 10, target: 9 };
};
