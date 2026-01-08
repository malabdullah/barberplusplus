import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { agentService } from '../../services/agent.service';
import BookingForm from '../../components/Forms/BookingForm';
import './AgentPages.css';

export default function AgentEditBooking() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id: bookingId } = useParams();
  const { selectedBranchId, user } = useApp();

  const [booking, setBooking] = useState(null);
  const [barbers, setBarbers] = useState([]);
  const [services, setServices] = useState([]);
  const [existingBookings, setExistingBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Load booking and branch data
  useEffect(() => {
    const loadData = async () => {
      if (!selectedBranchId || !bookingId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const [bookingsData, barbersData, servicesData] = await Promise.all([
          agentService.getBookings({ branchId: selectedBranchId }),
          agentService.getBarbers(selectedBranchId),
          agentService.getServices(selectedBranchId),
        ]);

        const bookingsList = bookingsData.bookings || bookingsData;
        const foundBooking = bookingsList.find(b => b.id === bookingId);

        if (!foundBooking) {
          setError(t('bookings.notFound'));
        } else {
          setBooking(foundBooking);
          setExistingBookings(bookingsList);
        }

        setBarbers(barbersData);
        setServices(servicesData);
      } catch (err) {
        console.error('Error loading data:', err);
        setError(t('common.errorLoading'));
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [selectedBranchId, bookingId, t]);

  // Handle booking update
  const handleSubmit = async (bookingData) => {
    setSubmitting(true);
    try {
      await agentService.updateBooking(bookingId, bookingData, user?.id);
      navigate('/agent/bookings');
    } catch (error) {
      console.error('Error updating booking:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate('/agent/bookings');
  };

  if (loading) {
    return (
      <div className="agent-new-booking-page">
        <div className="agent-page-header">
          <button className="btn btn-ghost" onClick={handleCancel}>
            <ArrowLeft size={18} />
            {t('common.back')}
          </button>
        </div>
        <div className="agent-loading">
          <span>{t('common.loading')}</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="agent-new-booking-page">
        <div className="agent-page-header">
          <button className="btn btn-ghost" onClick={handleCancel}>
            <ArrowLeft size={18} />
            {t('common.back')}
          </button>
        </div>
        <div className="agent-error-state">
          <AlertCircle size={48} />
          <h3>{error}</h3>
          <button className="btn btn-primary" onClick={handleCancel}>
            {t('common.back')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="agent-new-booking-page">
      <div className="agent-page-header">
        <div className="agent-page-header-left">
          <button className="btn btn-ghost" onClick={handleCancel}>
            <ArrowLeft size={18} />
            {t('common.back')}
          </button>
          <div className="agent-page-header-content">
            <h1 className="agent-page-title">{t('bookings.editBooking')}</h1>
            <p className="agent-page-description">{booking?.customerName}</p>
          </div>
        </div>
      </div>

      <div className="agent-booking-form-container">
        <BookingForm
          booking={booking}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          barbers={barbers}
          services={services}
          existingBookings={existingBookings}
          branchId={selectedBranchId}
        />
      </div>
    </div>
  );
}
