export type ResourceStatus = 'planned' | 'active' | 'disabled';

export interface ApiContract {
  status: ResourceStatus;
  message: string;
}

export const contractsStatus = {
  status: 'scaffolded',
  message: 'Shared API contracts are ready for real DTO definitions.'
};
