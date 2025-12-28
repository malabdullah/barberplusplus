import React, { useState, memo, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Building2,
  Plus,
  MapPin,
  Phone,
  Mail,
  Users,
  Scissors,
  Clock,
  Pencil,
  Trash2,
  Eye,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import ConfirmDialog from '../components/UI/ConfirmDialog';
import './Branches.css';

// Utility function moved outside component to prevent recreation
const formatHours = (hours) => {
  if (!hours?.open || !hours?.close) return 'Closed';
  return `${hours.open} - ${hours.close}`;
};

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const BranchCard = memo(function BranchCard({ branch, barberCount, serviceCount, onDelete }) {
  const navigate = useNavigate();
  const todayKey = DAY_KEYS[new Date().getDay()];
  const todayHours = branch.openingHours?.[todayKey];

  return (
    <div className="branch-card animate-fade-in-up">
      <div className="branch-card-header">
        <div className="branch-card-icon">
          {branch.imageUrl ? (
            <img src={branch.imageUrl} alt={branch.name} />
          ) : (
            <Building2 size={24} strokeWidth={1.5} />
          )}
        </div>
        <div className={`branch-status ${branch.status}`}>
          {branch.status === 'active' ? 'Open' : 'Closed'}
        </div>
      </div>

      <Link to={`/branches/${branch.id}`} className="branch-card-content">
        <h3 className="branch-card-name">{branch.name}</h3>

        <div className="branch-card-info">
          {(branch.areaName || branch.governorateName) && (
            <div className="branch-info-item">
              <MapPin size={14} strokeWidth={1.5} />
              <span>{[branch.areaName, branch.governorateName].filter(Boolean).join(', ')}</span>
            </div>
          )}
          {branch.phone && (
            <div className="branch-info-item">
              <Phone size={14} strokeWidth={1.5} />
              <span>{branch.phone}</span>
            </div>
          )}
          {branch.email && (
            <div className="branch-info-item">
              <Mail size={14} strokeWidth={1.5} />
              <span>{branch.email}</span>
            </div>
          )}
        </div>

        <div className="branch-card-stats">
          <div className="branch-stat">
            <Users size={16} strokeWidth={1.5} />
            <span>{barberCount} Barbers</span>
          </div>
          <div className="branch-stat">
            <Scissors size={16} strokeWidth={1.5} />
            <span>{serviceCount} Services</span>
          </div>
        </div>
      </Link>

      <div className="branch-card-footer">
        <div className="branch-hours">
          <Clock size={14} strokeWidth={1.5} />
          <span>Today: {formatHours(todayHours || {})}</span>
        </div>
        <div className="branch-actions">
          <button
            className="action-btn"
            onClick={() => navigate(`/branches/${branch.id}/edit`)}
            title="Edit Branch"
          >
            <Pencil size={16} strokeWidth={1.5} />
          </button>
          <button
            className="action-btn"
            onClick={() => navigate(`/branches/${branch.id}`)}
            title="View Details"
          >
            <Eye size={16} strokeWidth={1.5} />
          </button>
          <button
            className="action-btn danger"
            onClick={() => onDelete(branch)}
            title="Delete Branch"
          >
            <Trash2 size={16} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </div>
  );
});

export default function Branches() {
  const { branches, barbers, services, deleteBranch } = useApp();
  const [deletingBranch, setDeletingBranch] = useState(null);

  // Pre-compute counts per branch to avoid O(n*m) filtering in render loop
  const barberCountByBranch = useMemo(() => {
    const map = {};
    barbers.forEach(b => {
      map[b.branchId] = (map[b.branchId] || 0) + 1;
    });
    return map;
  }, [barbers]);

  const serviceCountByBranch = useMemo(() => {
    const map = {};
    services.forEach(s => {
      map[s.branchId] = (map[s.branchId] || 0) + 1;
    });
    return map;
  }, [services]);

  const handleDeleteBranch = useCallback((branch) => {
    setDeletingBranch(branch);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (deletingBranch) {
      deleteBranch(deletingBranch.id);
      setDeletingBranch(null);
    }
  }, [deletingBranch, deleteBranch]);

  return (
    <div className="branches-page">
      <div className="page-header animate-fade-in">
        <div className="page-header-content">
          <h2 className="page-title">Your Branches</h2>
          <p className="page-description">
            Manage all your barbershop locations from one place
          </p>
        </div>
        <Link to="/branches/new" className="btn btn-primary">
          <Plus size={18} strokeWidth={2} />
          Add Branch
        </Link>
      </div>

      {branches.length > 0 ? (
        <div className="branches-grid">
          {branches.map((branch, index) => (
            <BranchCard
              key={branch.id}
              branch={branch}
              barberCount={barberCountByBranch[branch.id] || 0}
              serviceCount={serviceCountByBranch[branch.id] || 0}
              onDelete={handleDeleteBranch}
              style={{ animationDelay: `${index * 50}ms` }}
            />
          ))}

          {/* Add Branch Card */}
          <Link to="/branches/new" className="add-branch-card animate-fade-in-up">
            <div className="add-branch-icon">
              <Plus size={32} strokeWidth={1.5} />
            </div>
            <span>Add New Branch</span>
          </Link>
        </div>
      ) : (
        <div className="empty-state animate-fade-in-up">
          <div className="empty-state-icon">
            <Building2 size={48} strokeWidth={1} />
          </div>
          <h3>No branches yet</h3>
          <p>Add your first barbershop location to get started</p>
          <Link to="/branches/new" className="btn btn-primary">
            <Plus size={18} strokeWidth={2} />
            Add Your First Branch
          </Link>
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deletingBranch}
        onClose={() => setDeletingBranch(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Branch"
        message={`Are you sure you want to delete "${deletingBranch?.name}"? This will also remove all associated barbers, services, and bookings. This action cannot be undone.`}
        confirmText="Delete Branch"
        variant="danger"
      />
    </div>
  );
}
