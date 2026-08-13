/**
 * Lightweight, offline topic suggestions.
 *
 * Suggestions are matched on keywords in the course name and are *never*
 * mandatory: the student accepts, renames, reorders or removes them freely.
 * Deliberately local (no API, no third-party service, no cost).
 */

interface SuggestionGroup {
  keywords: string[];
  topics: string[];
}

const GROUPS: SuggestionGroup[] = [
  {
    keywords: ['constitutional law', 'constitution'],
    topics: [
      'Fundamental Rights',
      'Separation of Powers',
      'Federalism',
      'Judicial Review',
      'Citizenship',
      'Emergency Powers',
    ],
  },
  {
    keywords: ['contract'],
    topics: [
      'Offer and Acceptance',
      'Consideration',
      'Intention to Create Legal Relations',
      'Terms of Contract',
      'Misrepresentation',
      'Discharge and Remedies',
    ],
  },
  {
    keywords: ['criminal law', 'criminal'],
    topics: [
      'Elements of a Crime',
      'Actus Reus and Mens Rea',
      'Homicide',
      'Offences Against Property',
      'Defences',
      'Inchoate Offences',
    ],
  },
  {
    keywords: ['tort'],
    topics: ['Negligence', 'Duty of Care', 'Defamation', 'Trespass', 'Nuisance', 'Vicarious Liability'],
  },
  {
    keywords: ['land law', 'property law'],
    topics: ['Nature of Land', 'Land Tenure', 'Leases', 'Mortgages', 'Easements', 'Co-ownership'],
  },
  {
    keywords: ['evidence'],
    topics: ['Relevance', 'Admissibility', 'Burden of Proof', 'Hearsay', 'Confessions', 'Witnesses'],
  },
  {
    keywords: ['company law', 'corporate'],
    topics: [
      'Incorporation',
      'Corporate Personality',
      'Directors’ Duties',
      'Shares and Capital',
      'Meetings and Resolutions',
      'Winding Up',
    ],
  },
  {
    keywords: ['equity', 'trust'],
    topics: ['Nature of Equity', 'Express Trusts', 'Resulting Trusts', 'Constructive Trusts', 'Equitable Remedies'],
  },
  {
    keywords: ['mathematics', 'calculus', 'maths'],
    topics: ['Limits and Continuity', 'Differentiation', 'Integration', 'Series', 'Differential Equations'],
  },
  {
    keywords: ['statistics', 'probability'],
    topics: [
      'Descriptive Statistics',
      'Probability Distributions',
      'Sampling',
      'Hypothesis Testing',
      'Regression',
    ],
  },
  {
    keywords: ['programming', 'computer science', 'software', 'algorithms'],
    topics: [
      'Data Types and Variables',
      'Control Flow',
      'Functions',
      'Data Structures',
      'Algorithms and Complexity',
      'Testing and Debugging',
    ],
  },
  {
    keywords: ['database'],
    topics: ['Relational Model', 'SQL Queries', 'Normalisation', 'Indexing', 'Transactions'],
  },
  {
    keywords: ['accounting', 'financial'],
    topics: [
      'Accounting Concepts',
      'Double Entry',
      'Trial Balance',
      'Financial Statements',
      'Depreciation',
      'Ratio Analysis',
    ],
  },
  {
    keywords: ['economics', 'micro', 'macro'],
    topics: ['Demand and Supply', 'Elasticity', 'Market Structures', 'National Income', 'Inflation', 'Fiscal Policy'],
  },
  {
    keywords: ['anatomy'],
    topics: ['Cells and Tissues', 'Skeletal System', 'Muscular System', 'Nervous System', 'Cardiovascular System'],
  },
  {
    keywords: ['physiology'],
    topics: ['Homeostasis', 'Cardiovascular Physiology', 'Respiratory Physiology', 'Renal Physiology', 'Endocrine System'],
  },
  {
    keywords: ['physics'],
    topics: ['Mechanics', 'Waves', 'Thermodynamics', 'Electricity and Magnetism', 'Modern Physics'],
  },
  {
    keywords: ['chemistry'],
    topics: ['Atomic Structure', 'Chemical Bonding', 'Stoichiometry', 'Thermochemistry', 'Organic Reactions'],
  },
  {
    keywords: ['biology'],
    topics: ['Cell Biology', 'Genetics', 'Evolution', 'Ecology', 'Human Systems'],
  },
  {
    keywords: ['engineering', 'circuit', 'mechanics'],
    topics: ['Fundamental Principles', 'Analysis Methods', 'Design Calculations', 'Standards', 'Laboratory Practice'],
  },
];

/** Generic fallback so every course can start with a usable outline. */
const GENERIC = [
  'Course Introduction',
  'Core Concepts',
  'Key Cases / Examples',
  'Past Questions',
  'Revision Summary',
];

export function suggestTopics(courseName: string): string[] {
  const name = courseName.trim().toLowerCase();
  if (!name) return [];

  const matches = GROUPS.filter((group) =>
    group.keywords.some((keyword) => name.includes(keyword)),
  );

  if (matches.length === 0) return GENERIC;

  const seen = new Set<string>();
  const topics: string[] = [];
  for (const group of matches) {
    for (const topic of group.topics) {
      if (seen.has(topic)) continue;
      seen.add(topic);
      topics.push(topic);
    }
  }
  return topics;
}
