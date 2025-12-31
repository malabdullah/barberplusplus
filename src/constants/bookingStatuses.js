import { CheckCircle, AlertCircle, XCircle } from 'lucide-react';

// Status constants to avoid magic strings throughout the codebase
export const BOOKING_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no-show',
};

export const BOOKING_STATUS_CONFIG = {
  confirmed: {
    icon: CheckCircle,
    label: 'Confirmed',
    color: 'success',
    class: 'status-confirmed'
  },
  pending: {
    icon: AlertCircle,
    label: 'Pending',
    color: 'warning',
    class: 'status-pending'
  },
  completed: {
    icon: CheckCircle,
    label: 'Completed',
    color: 'info',
    class: 'status-completed'
  },
  cancelled: {
    icon: XCircle,
    label: 'Cancelled',
    color: 'error',
    class: 'status-cancelled'
  },
  'no-show': {
    icon: XCircle,
    label: 'No Show',
    color: 'error',
    class: 'status-noshow'
  },
};

export const BOOKING_STATUSES = Object.keys(BOOKING_STATUS_CONFIG);

export const getStatusConfig = (status) =>
  BOOKING_STATUS_CONFIG[status] || BOOKING_STATUS_CONFIG.pending;
