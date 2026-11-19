import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { SubscriptionPreviewProvider } from '../context/SubscriptionPreviewContext';
import BillingPreview from './BillingPreview';
import SubscriptionCalculatorPreview from './SubscriptionCalculatorPreview';
import AdminSubscriptionsPreview from './AdminSubscriptionsPreview';

// The parent /design/* route is mounted only by the Test runtime.
export default function SubscriptionDesign() {
  return <SubscriptionPreviewProvider><Routes>
    <Route path="billing" element={<BillingPreview/>}/>
    <Route path="calculator" element={<SubscriptionCalculatorPreview/>}/>
    <Route path="subscriptions" element={<AdminSubscriptionsPreview/>}/>
    <Route path="subscriptions/:businessId" element={<AdminSubscriptionsPreview/>}/>
    <Route path="discounts" element={<AdminSubscriptionsPreview codesOnly/>}/>
    <Route path="*" element={<Navigate to="/design/billing" replace/>}/>
  </Routes></SubscriptionPreviewProvider>;
}
