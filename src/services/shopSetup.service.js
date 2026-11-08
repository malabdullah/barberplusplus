import { branchesService } from './branches.service';
import { barbersService } from './barbers.service';
import { servicesService } from './services.service';
export const shopSetupService = {
  async get(id, managerId) {
    const shop = await branchesService.getById(id);
    if (!shop || shop.managerId !== managerId) throw new Error('SHOP_NOT_FOUND');
    const [services, barbers] = await Promise.all([servicesService.getAll(id), barbersService.getAll(id)]);
    return { shop, services, barbers };
  },
};
