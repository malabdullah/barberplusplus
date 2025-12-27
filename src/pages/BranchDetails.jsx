import React, { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  MapPin,
  Phone,
  Mail,
  Clock,
  Users,
  Scissors,
  Calendar,
  Edit,
  Trash2,
  Plus,
  ChevronRight,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { DAY_KEYS as DAYS, DAY_LABELS } from '../constants/time';
import Modal from '../components/UI/Modal';
import BranchForm from '../components/Forms/BranchForm';
import ConfirmDialog from '../components/UI/ConfirmDialog';
import './BranchDetails.css';

export default function BranchDetails() {
  const { branchId } = useParams();
  const navigate = useNavigate();
  const { branches, barbers, services, bookings, updateBranch, deleteBranch } = useApp();

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const branch = branches.find(b => b.id === branchId);
  const branchBarbers = barbers.filter(b => b.branchId === branchId);
  const branchServices = services.filter(s => s.branchId === branchId);
  const branchBookings = bookings.filter(b => b.branchId === branchId);

  if (!branch) {
    return (
      <div className="not-found">
        <h2>Branch not found</h2>
        <Link to="/branches" className="btn btn-primary">
          Back to Branches
        </Link>
      </div>
    );
  }

  const handleUpdate = (data) => {
    updateBranch(branchId, data);
    setIsEditOpen(false);
  };

  const handleDelete = () => {
    deleteBranch(branchId);
    navigate('/branches');
  };

  const formatHours = (hours) => {
    if (!hours?.open || !hours?.close) return 'Closed';
    return `${hours.open} - ${hours.close}`;
  };

  const todayBookings = branchBookings.filter(
    b => b.date === new Date().toISOString().split('T')[0]
  );

  return (
    <div className="branch-details-page">
      {/* Back Button */}
      <Link to="/branches" className="back-link animate-fade-in">
        <ArrowLeft size={18} strokeWidth={1.5} />
        Back to Branches
      </Link>

      {/* Header */}
      <div className="branch-details-header animate-fade-in-up">
        <div className="branch-details-info">
          <h1 className="branch-details-name">{branch.name}</h1>
          <div className="branch-details-meta">
            {(branch.areaName || branch.governorateName) && (
              <div className="meta-item">
                <MapPin size={16} strokeWidth={1.5} />
                <span>{[branch.areaName, branch.governorateName].filter(Boolean).join(', ')}</span>
              </div>
            )}
            {branch.phone && (
              <div className="meta-item">
                <Phone size={16} strokeWidth={1.5} />
                <span>{branch.phone}</span>
              </div>
            )}
            {branch.email && (
              <div className="meta-item">
                <Mail size={16} strokeWidth={1.5} />
                <span>{branch.email}</span>
              </div>
            )}
          </div>
        </div>

        <div className="branch-details-actions">
          <button className="btn btn-secondary" onClick={() => setIsEditOpen(true)}>
            <Edit size={16} strokeWidth={1.5} />
            Edit
          </button>
          <button className="btn btn-danger-outline" onClick={() => setIsDeleteOpen(true)}>
            <Trash2 size={16} strokeWidth={1.5} />
            Delete
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="branch-stats-row animate-fade-in-up stagger-1">
        <div className="branch-stat-card">
          <div className="stat-icon">
            <Users size={22} strokeWidth={1.5} />
          </div>
          <div className="stat-content">
            <div className="stat-value">{branchBarbers.length}</div>
            <div className="stat-label">Barbers</div>
          </div>
        </div>
        <div className="branch-stat-card">
          <div className="stat-icon">
            <Scissors size={22} strokeWidth={1.5} />
          </div>
          <div className="stat-content">
            <div className="stat-value">{branchServices.length}</div>
            <div className="stat-label">Services</div>
          </div>
        </div>
        <div className="branch-stat-card">
          <div className="stat-icon">
            <Calendar size={22} strokeWidth={1.5} />
          </div>
          <div className="stat-content">
            <div className="stat-value">{todayBookings.length}</div>
            <div className="stat-label">Today's Bookings</div>
          </div>
        </div>
      </div>

      {/* Content Grid */}
      <div className="branch-content-grid">
        {/* Team Members - aligns with Barbers stat */}
        <div className="branch-content-card animate-fade-in-up stagger-2">
          <div className="content-card-header">
            <Users size={20} strokeWidth={1.5} />
            <h3>Team Members</h3>
            <Link to="/barbers" className="content-card-link">
              Manage <ChevronRight size={14} />
            </Link>
          </div>
          {branchBarbers.length > 0 ? (
            <div className="team-list">
              {branchBarbers.slice(0, 4).map((barber) => (
                <div key={barber.id} className="team-member">
                  <div className="team-avatar">
                    {barber.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div className="team-info">
                    <span className="team-name">{barber.name}</span>
                    <span className="team-specialties">
                      {barber.specialties?.slice(0, 2).join(', ')}
                    </span>
                  </div>
                  <div className={`team-status ${barber.status}`}>
                    {barber.status === 'active' ? 'Active' : 'Away'}
                  </div>
                </div>
              ))}
              {branchBarbers.length > 4 && (
                <Link to="/barbers" className="view-more-link">
                  +{branchBarbers.length - 4} more barbers
                </Link>
              )}
            </div>
          ) : (
            <div className="empty-section">
              <p>No barbers assigned to this branch</p>
              <Link to="/barbers" className="btn btn-sm btn-primary">
                <Plus size={14} /> Add Barber
              </Link>
            </div>
          )}
        </div>

        {/* Services List - aligns with Services stat */}
        <div className="branch-content-card animate-fade-in-up stagger-3">
          <div className="content-card-header">
            <Scissors size={20} strokeWidth={1.5} />
            <h3>Services Offered</h3>
            <Link to="/services" className="content-card-link">
              Manage <ChevronRight size={14} />
            </Link>
          </div>
          {branchServices.length > 0 ? (
            <div className="services-list">
              {branchServices.slice(0, 5).map((service) => (
                <div key={service.id} className="service-item">
                  <div className="service-details">
                    <span className="service-name">{service.name}</span>
                    <span className="service-duration">{service.duration} min</span>
                  </div>
                  <span className="service-price">{service.price} KWD</span>
                </div>
              ))}
              {branchServices.length > 5 && (
                <Link to="/services" className="view-more-link">
                  +{branchServices.length - 5} more services
                </Link>
              )}
            </div>
          ) : (
            <div className="empty-section">
              <p>No services configured for this branch</p>
              <Link to="/services" className="btn btn-sm btn-primary">
                <Plus size={14} /> Add Service
              </Link>
            </div>
          )}
        </div>

        {/* Operating Hours - aligns with Today's Bookings stat */}
        <div className="branch-content-card animate-fade-in-up stagger-4">
          <div className="content-card-header">
            <Clock size={20} strokeWidth={1.5} />
            <h3>Operating Hours</h3>
          </div>
          <div className="hours-grid">
            {DAYS.map((day, index) => {
              const hours = branch.openingHours?.[day];
              const isToday = new Date().getDay() === (index + 1) % 7;
              return (
                <div key={day} className={`hours-row ${isToday ? 'today' : ''}`}>
                  <span className="hours-day">{DAY_LABELS[index]}</span>
                  <span className={`hours-time ${!hours?.open ? 'closed' : ''}`}>
                    {formatHours(hours)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      <Modal
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        title="Edit Branch"
      >
        <BranchForm
          branch={branch}
          onSubmit={handleUpdate}
          onCancel={() => setIsEditOpen(false)}
        />
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete Branch"
        message={`Are you sure you want to delete "${branch.name}"? This action cannot be undone.`}
        confirmText="Delete Branch"
        variant="danger"
      />
    </div>
  );
}
