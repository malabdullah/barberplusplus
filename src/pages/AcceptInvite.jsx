import React from 'react';
import CustomerPassword from './CustomerPassword';
import JoinShop from './JoinShop';
import { hasShopInvitation } from '../lib/shopInvitation';

export default function AcceptInvite() {
  return hasShopInvitation() ? <JoinShop /> : <CustomerPassword mode="invite" audience="work" />;
}
