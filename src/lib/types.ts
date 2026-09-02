/** A consultation outcome for one customer visit. */
export type ConsultationStatus = 'purchased' | 'declined' | 'consultation_only';

export interface CustomerRecord {
  id: string;
  customerName: string;
  treatment: string;
  provider: string;
  status: ConsultationStatus;
  /** Total spent on this visit, in NZD. Zero when nothing was purchased. */
  amountSpent: number;
  /** ISO date (YYYY-MM-DD) of the visit. */
  lastVisit: string;
  rebooked: boolean;
  /** 1-5, or null when the customer left no rating. */
  satisfaction: number | null;
}

/** Which source of truth a question needs. */
export type RetrievalPath = 'structured' | 'knowledge' | 'both';

export interface TreatmentPerformance {
  treatment: string;
  consultations: number;
  conversionRate: number;
  rebookingRate: number;
  averageSpend: number;
  averageSatisfaction: number | null;
}
