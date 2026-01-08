import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Calendar } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { agentService } from '../../services/agent.service';
import BookingForm from '../../components/Forms/BookingForm';
import './AgentPages.css';

export default function AgentNewBooking() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { selectedBranchId, user } = useApp();

  const [barbers, setBarbers] = useState([]);
  const [services, setServices] = useState([]);
  const [existingBookings, setExistingBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Load branch data
  useEffect(() => {
    const loadData = async () => {
      if (!selectedBranchId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const [barbersData, servicesData, bookingsData] = await Promise.all([
          agentService.getBarbers(selectedBranchId),
          agentService.getServices(selectedBranchId),
          agentService.getBookings({ branchId: selectedBranchId }),
        ]);
        setBarbers(barbersData);
        setServices(servicesData);
        setExistingBookings(bookingsData.bookings || bookingsData);
      } catch (error) {
        console.error('Error loading data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [selectedBranchId]);

  // Handle booking creation
  const handleSubmit = async (bookingData) => {
    setSubmitting(true);
    try {
      await agentService.createBooking({
        ...bookingData,
        branchId: selectedBranchId,
        agentUserId: user?.id,
      });
      navigate('/agent/bookings');
    } catch (error) {
      console.error('Error creating booking:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate('/agent/bookings');
  };

  if (!selectedBranchId) {
    return (
      <div className="agent-new-booking-page">
        <div className="agent-page-header">
          <button className="btn btn-ghost" onClick={handleCancel}>
            <ArrowLeft size={18} />
            {t('common.back')}
          </button>
        </div>
        <div className="agent-select-branch-notice">
          <Calendar size={48} />
          <h3>{t('agent.bookings.selectBranch')}</h3>
          <p>{t('agent.bookings.selectBranchDesc')}</p>
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
            <h1 className="agent-page-title">{t('bookings.newBooking')}</h1>
            <p className="agent-page-description">{t('agent.bookings.newBookingDesc')}</p>
          </div>
        </div>
      </div>

      <div className="agent-booking-form-container">
        {loading ? (
          <div className="agent-loading">
            <span>{t('common.loading')}</span>
          </div>
        ) : (
          <BookingForm
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            barbers={barbers}
            services={services}
            existingBookings={existingBookings}
            branchId={selectedBranchId}
          />
        )}
      </div>
    </div>
  );
}
