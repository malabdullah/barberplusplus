import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useApp } from '../context/AppContext';
import BarberForm from '../components/Forms/BarberForm';
import './AddBranch.css';

export default function EditBarber() {
  const { barberId } = useParams();
  const navigate = useNavigate();
  const { branchBarbers, branchServices, updateBarber } = useApp();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const barber = branchBarbers.find((b) => b.id === barberId);

  const handleSubmit = async (data) => {
    setIsSubmitting(true);
    try {
      await updateBarber(barberId, data);
      navigate('/barbers');
    } catch (error) {
      console.error('Error updating barber:', error);
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate('/barbers');
  };

  if (!barber) {
    return (
      <div className="edit-branch-page">
        <Link to="/barbers" className="back-link animate-fade-in">
          <ArrowLeft size={18} strokeWidth={1.5} />
          Back to Barbers
        </Link>
        <div className="not-found">
          <h2>Barber not found</h2>
          <Link to="/barbers" className="btn btn-primary">
            Back to Barbers
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="edit-branch-page">
      <Link to="/barbers" className="back-link animate-fade-in">
        <ArrowLeft size={18} strokeWidth={1.5} />
        Back to Barbers
      </Link>

      <div className="edit-branch-header animate-fade-in-up">
        <h1>Edit Barber</h1>
        <p>Update profile for {barber.name}</p>
      </div>

      <div className="edit-branch-form-container animate-fade-in-up stagger-1">
        <BarberForm
          barber={barber}
          services={branchServices}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          isSubmitting={isSubmitting}
        />
      </div>
    </div>
  );
}
