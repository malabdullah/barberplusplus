import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useApp } from '../context/AppContext';
import BranchForm from '../components/Forms/BranchForm';
import './AddBranch.css';

export default function AddBranch() {
  const navigate = useNavigate();
  const { addBranch } = useApp();
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (data) => {
    setError(null);
    setIsSubmitting(true);
    try {
      await addBranch(data);
      navigate('/branches');
    } catch (err) {
      console.error('Error creating branch:', err);
      setError(err.message || 'Failed to create branch. Please try again.');
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate('/branches');
  };

  return (
    <div className="add-branch-page">
      <Link to="/branches" className="back-link animate-fade-in">
        <ArrowLeft size={18} strokeWidth={1.5} />
        Back to Branches
      </Link>

      <div className="add-branch-header animate-fade-in-up">
        <h1>Add New Branch</h1>
        <p>Create a new barbershop location</p>
      </div>

      {error && (
        <div className="error-banner animate-fade-in">
          {error}
        </div>
      )}

      <div className="add-branch-form-container animate-fade-in-up stagger-1">
        <BranchForm
          branch={null}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          isSubmitting={isSubmitting}
        />
      </div>
    </div>
  );
}
