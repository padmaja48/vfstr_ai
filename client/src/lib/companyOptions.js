const COMPANY_CATALOG = [
  { label: 'Google', tier: 'super_dream' },
  { label: 'Microsoft', tier: 'super_dream' },
  { label: 'Amazon', tier: 'super_dream' },
  { label: 'Apple', tier: 'super_dream' },
  { label: 'Meta', tier: 'super_dream' },
  { label: 'NVIDIA', tier: 'super_dream' },
  { label: 'Goldman Sachs', tier: 'super_dream' },
  { label: 'Morgan Stanley', tier: 'super_dream' },
  { label: 'Visa', tier: 'super_dream' },
  { label: 'Mastercard', tier: 'super_dream' },
  { label: 'JPMorgan Chase', tier: 'super_dream' },
  { label: 'Bank of America', tier: 'super_dream' },
  { label: 'American Express', tier: 'super_dream' },
  { label: 'Adobe', tier: 'super_dream' },
  { label: 'Salesforce', tier: 'super_dream' },
  { label: 'ServiceNow', tier: 'super_dream' },
  { label: 'Atlassian', tier: 'super_dream' },
  { label: 'PayPal', tier: 'super_dream' },
  { label: 'Cisco', tier: 'super_dream' },
  { label: 'Intel', tier: 'super_dream' },
  { label: 'Qualcomm', tier: 'super_dream' },
  { label: 'BlackRock', tier: 'super_dream' },
  { label: 'Walmart Global Tech', tier: 'super_dream' },
  { label: 'Uber', tier: 'super_dream' },
  { label: 'OpenAI', tier: 'super_dream' },

  { label: 'Oracle', tier: 'dream' },
  { label: 'SAP', tier: 'dream' },
  { label: 'Siemens', tier: 'dream' },
  { label: 'Snowflake', tier: 'dream' },
  { label: 'Palo Alto Networks', tier: 'dream' },
  { label: 'McKinsey & Company', tier: 'dream' },
  { label: 'Bain & Company', tier: 'dream' },
  { label: 'UBS', tier: 'dream' },
  { label: 'Barclays', tier: 'dream' },
  { label: 'HSBC', tier: 'dream' },
  { label: 'State Street', tier: 'dream' },
  { label: 'BNY', tier: 'dream' },
  { label: 'Fidelity Investments', tier: 'dream' },
  { label: 'Fiserv', tier: 'dream' },
  { label: 'FIS', tier: 'dream' },
  { label: 'FactSet', tier: 'dream' },
  { label: 'Broadridge', tier: 'dream' },
  { label: 'Expedia Group', tier: 'dream' },
  { label: 'Booking.com', tier: 'dream' },
  { label: 'Nutanix', tier: 'dream' },
  { label: 'Rubrik', tier: 'dream' },
  { label: 'Cohesity', tier: 'dream' },
  { label: 'Cloudera', tier: 'dream' },
  { label: 'Red Hat', tier: 'dream' },
  { label: 'Juniper Networks', tier: 'dream' },

  { label: 'Razorpay', tier: 'product' },
  { label: 'CRED', tier: 'product' },
  { label: 'Meesho', tier: 'product' },
  { label: 'Swiggy', tier: 'product' },
  { label: 'Zomato', tier: 'product' },
  { label: 'InMobi', tier: 'product' },
  { label: 'Freshworks', tier: 'product' },
  { label: 'Zoho', tier: 'product' },
  { label: 'Flipkart', tier: 'product' },
  { label: 'PhonePe', tier: 'product' },
  { label: 'Ola', tier: 'product' },
  { label: 'HighRadius', tier: 'product' },
  { label: 'Arcesium', tier: 'product' },
  { label: 'RealPage', tier: 'product' },
  { label: 'Quantela', tier: 'product' },
  { label: 'Paytm', tier: 'product' },
  { label: 'Groww', tier: 'product' },
  { label: 'Udaan', tier: 'product' },
  { label: 'Nykaa', tier: 'product' },
  { label: 'Cars24', tier: 'product' },
  { label: 'MakeMyTrip', tier: 'product' },
  { label: 'OYO', tier: 'product' },
  { label: 'Dream11', tier: 'product' },
  { label: 'Myntra', tier: 'product' },
  { label: 'Policybazaar', tier: 'product' },

  { label: 'TCS', tier: 'service' },
  { label: 'Infosys', tier: 'service' },
  { label: 'Wipro', tier: 'service' },
  { label: 'HCLTech', tier: 'service' },
  { label: 'Cognizant', tier: 'service' },
  { label: 'Accenture', tier: 'service' },
  { label: 'Deloitte', tier: 'service' },
  { label: 'EY', tier: 'service' },
  { label: 'KPMG', tier: 'service' },
  { label: 'PwC', tier: 'service' },
  { label: 'Capgemini', tier: 'service' },
  { label: 'Tech Mahindra', tier: 'service' },
  { label: 'LTIMindtree', tier: 'service' },
  { label: 'Mphasis', tier: 'service' },
  { label: 'Persistent Systems', tier: 'service' },
  { label: 'Hexaware Technologies', tier: 'service' },
  { label: 'Birlasoft', tier: 'service' },
  { label: 'Coforge', tier: 'service' },
  { label: 'UST', tier: 'service' },
  { label: 'Brillio', tier: 'service' },
  { label: 'Happiest Minds', tier: 'service' },
  { label: 'Nagarro', tier: 'service' },
  { label: 'Genpact', tier: 'service' },
  { label: 'CGI', tier: 'service' },
  { label: 'Zensar', tier: 'service' },
];

export const COMPANY_TIER_ORDER = ['super_dream', 'dream', 'product', 'service'];

export const COMPANY_TIER_LABELS = {
  super_dream: 'SUPER DREAM',
  dream: 'DREAM',
  product: 'PRODUCT BASED',
  service: 'SERVICE',
};

export const COMPANY_TIER_COLORS = {
  super_dream: '#f5b942',
  dream: '#2dd4bf',
  product: '#a78bfa',
  service: '#60a5fa',
};

export const NO_SPECIFIC_COMPANY_OPTION = {
  value: '',
  label: 'No specific company',
  tier: 'default',
};

const slugifyCompany = (name) =>
  name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const uniqueCompanies = Array.from(
  new Map(
    COMPANY_CATALOG.map((entry) => {
      const value = slugifyCompany(entry.label);
      return [value, { value, label: entry.label, tier: entry.tier }];
    }),
  ).values(),
);

export const COMPANY_OPTIONS = uniqueCompanies.sort((a, b) => {
  const tierDelta = COMPANY_TIER_ORDER.indexOf(a.tier) - COMPANY_TIER_ORDER.indexOf(b.tier);
  if (tierDelta !== 0) return tierDelta;
  return a.label.localeCompare(b.label);
});
