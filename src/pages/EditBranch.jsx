import React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useApp } from '../context/AppContext';
import BranchForm from '../components/Forms/BranchForm';
import './AddBranch.css';

export default function EditBranch() {
  const { branchId } = useParams();
  const navigate = useNavigate();
  const { branches, updateBranch } = useApp();

  const branch = branches.find((b) => b.id === branchId);

  const handleSubmit = (data) => {
    updateBranch(branchId, data);
    navigate('/branches');
  };

  const handleCancel = () => {
    navigate('/branches');
  };

  if (!branch) {
    return (
      <div className="edit-branch-page">
        <Link to="/branches" className="back-link animate-fade-in">
          <ArrowLeft size={18} strokeWidth={1.5} />
          Back to Branches
        </Link>
        <div className="not-found">
          <h2>Branch not found</h2>
          <Link to="/branches" className="btn btn-primary">
            Back to Branches
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="edit-branch-page">
      <Link to="/branches" className="back-link animate-fade-in">
        <ArrowLeft size={18} strokeWidth={1.5} />
        Back to Branches
      </Link>

      <div className="edit-branch-header animate-fade-in-up">
        <h1>Edit Branch</h1>
        <p>Update details for {branch.name}</p>
      </div>

      <div className="edit-branch-form-container animate-fade-in-up stagger-1">
        <BranchForm
          branch={branch}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      </div>
    </div>
  );
}
