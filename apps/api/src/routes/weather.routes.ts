import { Router } from 'express';
import { weatherController } from '../controllers/weather.controller.js';

export const weatherRoutes = Router();

weatherRoutes.get('/', weatherController.list);
weatherRoutes.get('/:locationId', weatherController.getByLocation);
