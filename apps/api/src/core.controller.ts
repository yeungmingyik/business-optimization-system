import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService, AuthRequest } from './auth.service';
import { CoreService } from './core.service';
import { channels } from './validation';

@Controller()
export class CoreController {
  constructor(
    @Inject(CoreService) private readonly core: CoreService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  @Get('health') async health() {
    await this.core.db.query('SELECT 1');
    return { status: 'ok' };
  }
  @Post('auth/login') login(
    @Body() data: any,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.login(data, req, res);
  }
  @Get('auth/me') me(@Req() req: AuthRequest) {
    return { user: req.user, csrfToken: req.csrfToken };
  }
  @Post('auth/logout') logout(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    return this.auth.logout(req, res);
  }
  @Post('auth/change-password') changePassword(@Req() req: AuthRequest, @Body() data: any) {
    return this.auth.changePassword(req.user, data);
  }
  @Get('users') users(@Req() req: AuthRequest, @Query() query: any) {
    return this.core.listUsers(req.user, query);
  }
  @Post('users') createUser(@Req() req: AuthRequest, @Body() data: any) {
    return this.core.createUser(req.user, data);
  }
  @Patch('users/:id') updateUser(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.core.updateUser(req.user, id, data);
  }
  @Post('users/:id/reset-password') resetPassword(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.core.resetPassword(req.user, id, data);
  }
  @Post('users/:id/disable') disableUser(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.core.updateUser(req.user, id, { ...data, accountStatus: 'DISABLED' });
  }
  @Get('channels') channels() {
    return channels;
  }
  @Get('merchant-accounts') merchantAccounts(@Req() req: AuthRequest, @Query() query: any) {
    return this.core.listMerchantAccounts(req.user, query);
  }
  @Post('merchant-accounts') createMerchant(@Req() req: AuthRequest, @Body() data: any) {
    return this.core.saveMerchantAccount(req.user, data);
  }
  @Patch('merchant-accounts/:id') updateMerchant(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.core.saveMerchantAccount(req.user, data, id);
  }
  @Get('dictionaries') dictionaries(@Req() req: AuthRequest, @Query() query: any) {
    return this.core.listDictionaries(req.user, query);
  }
  @Post('dictionaries') createDictionary(@Req() req: AuthRequest, @Body() data: any) {
    return this.core.saveDictionary(req.user, data);
  }
  @Patch('dictionaries/:id') updateDictionary(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.core.saveDictionary(req.user, data, id);
  }
  @Post('dictionaries/:id/archive') archiveDictionary(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.core.archiveDictionary(req.user, id, data, true);
  }
  @Post('dictionaries/:id/restore') restoreDictionary(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.core.archiveDictionary(req.user, id, data, false);
  }
  @Get('customers') customers(@Req() req: AuthRequest, @Query() query: any) {
    return this.core.listCustomers(req.user, query);
  }
  @Post('customers') createCustomer(@Req() req: AuthRequest, @Body() data: any) {
    return this.core.createCustomer(req.user, data);
  }
  @Get('customers/:id') customer(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.core.getCustomer(req.user, id);
  }
  @Patch('customers/:id') updateCustomer(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.core.updateCustomer(req.user, id, data);
  }
  @Post('customers/:id/assign') assignCustomer(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.core.assignCustomer(req.user, id, data);
  }
  @Post('customers/:id/deal-correction') correctCustomerDeal(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.core.correctCustomerDeal(req.user, id, data);
  }
  @Post('customers/:id/archive') archiveCustomer(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.core.archiveCustomer(req.user, id, data, true);
  }
  @Post('customers/:id/restore') restoreCustomer(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.core.archiveCustomer(req.user, id, data, false);
  }
  @Get('customers/:id/followups') followups(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Query() query: any,
  ) {
    return this.core.listFollowups(req.user, id, query);
  }
  @Post('customers/:id/followups') createFollowup(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.core.saveFollowup(req.user, id, data);
  }
  @Patch('customers/:id/followups/:followupId') updateFollowup(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Param('followupId') followupId: string,
    @Body() data: any,
  ) {
    return this.core.saveFollowup(req.user, id, data, followupId);
  }
  @Post('customers/:id/followup-task/complete') completeFollowup(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.core.completeFollowup(req.user, id, data);
  }
  @Get('products') products(@Req() req: AuthRequest, @Query() query: any) {
    return this.core.listProducts(req.user, query);
  }
  @Post('products') createProduct(@Req() req: AuthRequest, @Body() data: any) {
    return this.core.createProduct(req.user, data);
  }
  @Get('products/:id') product(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.core.getProduct(req.user, id);
  }
  @Patch('products/:id') updateProduct(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.core.updateProduct(req.user, id, data);
  }
  @Post('products/:id/archive') archiveProduct(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.core.archiveProduct(req.user, id, data, true);
  }
  @Post('products/:id/restore') restoreProduct(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.core.archiveProduct(req.user, id, data, false);
  }
  @Get('orders') orders(@Req() req: AuthRequest, @Query() query: any) {
    return this.core.listOrders(req.user, query);
  }
  @Post('orders') createOrder(@Req() req: AuthRequest, @Body() data: any) {
    return this.core.createOrder(req.user, data);
  }
  @Get('orders/:id') order(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.core.getOrder(req.user, id);
  }
  @Patch('orders/:id') updateOrder(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.core.updateOrder(req.user, id, data);
  }
  @Post('orders/:id/payment') payOrder(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.core.payOrder(req.user, id, data);
  }
  @Post('orders/:id/cancel') cancelOrder(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.core.cancelOrder(req.user, id, data);
  }
  @Post('orders/:id/payment-correction') correctPayment(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.core.correctPayment(req.user, id, data);
  }
  @Get('orders/:id/payments') payments(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.core.listPayments(req.user, id);
  }
  @Get('orders/:id/shipments') async shipments(@Req() req: AuthRequest, @Param('id') id: string) {
    return (await this.core.getOrder(req.user, id)).shipments;
  }
  @Post('orders/:id/shipments') createShipment(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.core.saveShipment(req.user, id, data);
  }
  @Patch('orders/:id/shipments/:shipmentId') updateShipment(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Param('shipmentId') shipmentId: string,
    @Body() data: any,
  ) {
    return this.core.saveShipment(req.user, id, data, shipmentId);
  }
  @Get('dashboard/summary') summary(@Req() req: AuthRequest, @Query() query: any) {
    return this.core.dashboard(req.user, query);
  }
  @Get('dashboard/trends') trends(@Req() req: AuthRequest, @Query() query: any) {
    return this.core.trends(req.user, query);
  }
  @Get('dashboard/followups') dashboardFollowups(@Req() req: AuthRequest, @Query() query: any) {
    return this.core.listCustomers(req.user, {
      ...query,
      startDate: undefined,
      endDate: undefined,
      followup: 'today',
    });
  }
  @Get('audit-events') audit(@Req() req: AuthRequest, @Query() query: any) {
    return this.core.auditEvents(req.user, query);
  }
}
