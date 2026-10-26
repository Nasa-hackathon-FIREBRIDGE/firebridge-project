export type DomainEntityId = string;

export interface DomainEntity {
  id: DomainEntityId;
  createdAt: Date;
  updatedAt: Date;
}

export const domainStatus = {
  status: 'scaffolded',
  message: 'Domain layer is ready for entity modeling and business rules.'
};
