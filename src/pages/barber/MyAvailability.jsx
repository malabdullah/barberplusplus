import React, { useState, useEffect } from 'react';
import {
  Clock,
  Calendar,
  Check,
  X,
  Save,
  RotateCcw,
  Plus,
  Trash2,
  Umbrella,
  Coffee,
  Copy,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { format, addDays } from 'date-fns';
import { DAYS as DAYS_OF_WEEK, TIME_OPTIONS, BARBER_DEFAULT_SCHEDULE as DEFAULT_SCHEDULE } from '../../constants/time';
import './MyAvailability.css';

// Convert from mock data format (array) to component format (object with enabled)
const convertAvailabilityFormat = (availability) => {
  const converted = {};
  DAYS_OF_WEEK.forEach(({ key }) => {
    const dayData = availability[key];
    if (Array.isArray(dayData)) {
      // Mock format: array of time slots
      if (dayData.length > 0) {
        converted[key] = {
          enabled: true,
          start: dayData[0].start,
          end: dayData[0].end,
        };
      } else {
        converted[key] = {
          enabled: false,
          start: '09:00',
          end: '18:00',
        };
      }
    } else if (dayData && typeof dayData === 'object' && 'enabled' in dayData) {
      converted[key] = dayData;
    } else {
      converted[key] = DEFAULT_SCHEDULE[key];
    }
  });
  return converted;
};

function DayScheduleRow({ day, schedule, onChange, onCopyToAll }) {
  const handleToggle = () => {
    onChange({
      ...schedule,
      enabled: !schedule.enabled,
    });
  };

  const handleTimeChange = (field, value) => {
    onChange({
      ...schedule,
      [field]: value,
    });
  };

  return (
    <div className={`schedule-row ${schedule.enabled ? 'enabled' : 'disabled'}`}>
      <div className="schedule-day">
        <button
          className={`schedule-toggle ${schedule.enabled ? 'active' : ''}`}
          onClick={handleToggle}
        >
          {schedule.enabled ? <Check size={14} strokeWidth={2} /> : <X size={14} strokeWidth={2} />}
        </button>
        <span className="schedule-day-label">{day.label}</span>
      </div>

      <div className="schedule-times">
        {schedule.enabled ? (
          <>
            <select
              className="schedule-time-select"
              value={schedule.start}
              onChange={(e) => handleTimeChange('start', e.target.value)}
            >
              {TIME_OPTIONS.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </select>
            <span className="schedule-time-separator">to</span>
            <select
              className="schedule-time-select"
              value={schedule.end}
              onChange={(e) => handleTimeChange('end', e.target.value)}
            >
              {TIME_OPTIONS.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </select>
            <button
              className="hours-copy-btn"
              onClick={onCopyToAll}
              title="Copy to all days"
            >
              <Copy size={14} strokeWidth={2} />
            </button>
          </>
        ) : (
          <span className="schedule-day-off">Day off</span>
        )}
      </div>

      <div className="schedule-hours">
        {schedule.enabled ? (
          <span className="schedule-hours-count">
            {calculateHours(schedule.start, schedule.end)}h
          </span>
        ) : (
          <span className="schedule-hours-off">-</span>
        )}
      </div>
    </div>
  );
}

function calculateHours(start, end) {
  const [startHour, startMin] = start.split(':').map(Number);
  const [endHour, endMin] = end.split(':').map(Number);
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;
  const diff = endMinutes - startMinutes;
  return (diff / 60).toFixed(1);
}

function calculateTotalHours(schedule) {
  let total = 0;
  Object.values(schedule).forEach((day) => {
    if (day.enabled) {
      const hours = parseFloat(calculateHours(day.start, day.end));
      if (hours > 0) total += hours;
    }
  });
  return total.toFixed(1);
}

// Time-Off Section Component
function TimeOffSection({ timeOffs, onAdd, onDelete, setHasChanges, schedule }) {
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    day: 'monday',
    start: '12:00',
    end: '13:00',
    reason: '',
  });

  const getDayLabel = (dayKey) => {
    const day = DAYS_OF_WEEK.find((d) => d.key === dayKey);
    return day ? day.label : dayKey;
  };

  const handleSubmit = () => {
    setError('');

    // Check if the selected day is already a day off
    if (schedule && schedule[formData.day] && !schedule[formData.day].enabled) {
      setError(`${getDayLabel(formData.day)} is already marked as a day off in your schedule`);
      return;
    }

    // Check if end time is after start time
    if (formData.start >= formData.end) {
      setError('End time must be after start time');
      return;
    }

    onAdd({
      id: `timeoff-${Date.now()}`,
      ...formData,
    });
    setFormData({ day: 'monday', start: '12:00', end: '13:00', reason: '' });
    setShowForm(false);
    setError('');
    setHasChanges(true);
  };

  const handleDelete = (id) => {
    onDelete(id);
    setHasChanges(true);
  };

  return (
    <div className="timeoff-section animate-fade-in-up">
      <div className="section-card">
        <div className="section-card-header">
          <div className="section-card-title">
            <Coffee size={20} strokeWidth={1.5} />
            <h3>Recurring Time-Off</h3>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
            <Plus size={16} strokeWidth={2} />
            Add Time-Off
          </button>
        </div>

        {showForm && (
          <div className="timeoff-form">
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Day</label>
                <select
                  className="form-select"
                  value={formData.day}
                  onChange={(e) => setFormData({ ...formData, day: e.target.value })}
                >
                  {DAYS_OF_WEEK.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">From</label>
                <select
                  className="form-select"
                  value={formData.start}
                  onChange={(e) => setFormData({ ...formData, start: e.target.value })}
                >
                  {TIME_OPTIONS.map((time) => (
                    <option key={time} value={time}>
                      {time}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">To</label>
                <select
                  className="form-select"
                  value={formData.end}
                  onChange={(e) => setFormData({ ...formData, end: e.target.value })}
                >
                  {TIME_OPTIONS.map((time) => (
                    <option key={time} value={time}>
                      {time}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Reason (optional)</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g., Lunch break, Personal appointment"
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
              />
            </div>
            {error && (
              <div className="form-error" style={{ color: 'var(--status-error)', marginBottom: '12px', fontSize: '14px' }}>
                {error}
              </div>
            )}
            <div className="form-actions">
              <button className="btn btn-ghost" onClick={() => { setShowForm(false); setError(''); }}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSubmit}>
                Add Time-Off
              </button>
            </div>
          </div>
        )}

        <div className="timeoff-list">
          {timeOffs.length === 0 ? (
            <div className="empty-state">
              <Coffee size={32} strokeWidth={1} />
              <p>No recurring time-off scheduled</p>
              <span>Add breaks or regular appointments that repeat weekly</span>
            </div>
          ) : (
            timeOffs.map((item) => (
              <div key={item.id} className="timeoff-card">
                <div className="timeoff-card-day">
                  <span className="timeoff-day-badge">{getDayLabel(item.day)}</span>
                </div>
                <div className="timeoff-card-time">
                  <Clock size={14} strokeWidth={2} />
                  <span>
                    {item.start} - {item.end}
                  </span>
                </div>
                {item.reason && <div className="timeoff-card-reason">{item.reason}</div>}
                <button className="timeoff-delete-btn" onClick={() => handleDelete(item.id)}>
                  <Trash2 size={16} strokeWidth={2} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// Vacations Section Component
function VacationsSection({ vacations, onAdd, onDelete, setHasChanges }) {
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const today = new Date().toISOString().split('T')[0];
  const [formData, setFormData] = useState({
    startDate: today,
    endDate: format(addDays(new Date(), 7), 'yyyy-MM-dd'),
    reason: '',
  });

  const handleSubmit = () => {
    setError('');

    // Check if end date is after start date
    if (formData.startDate > formData.endDate) {
      setError('End date must be on or after start date');
      return;
    }

    onAdd({
      id: `vacation-${Date.now()}`,
      ...formData,
    });
    setFormData({
      startDate: today,
      endDate: format(addDays(new Date(), 7), 'yyyy-MM-dd'),
      reason: '',
    });
    setShowForm(false);
    setError('');
    setHasChanges(true);
  };

  const handleDelete = (id) => {
    onDelete(id);
    setHasChanges(true);
  };

  const formatDateRange = (startDate, endDate) => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    return `${format(start, 'MMM d')} - ${format(end, 'MMM d, yyyy')}`;
  };

  const getVacationStatus = (endDate) => {
    const end = new Date(endDate);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return end < now ? 'past' : 'upcoming';
  };

  const getDaysCount = (startDate, endDate) => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays;
  };

  // Sort vacations: upcoming first, then by start date
  const sortedVacations = [...vacations].sort((a, b) => {
    const aStatus = getVacationStatus(a.endDate);
    const bStatus = getVacationStatus(b.endDate);
    if (aStatus !== bStatus) {
      return aStatus === 'upcoming' ? -1 : 1;
    }
    return new Date(a.startDate) - new Date(b.startDate);
  });

  return (
    <div className="vacations-section animate-fade-in-up">
      <div className="section-card">
        <div className="section-card-header">
          <div className="section-card-title">
            <Umbrella size={20} strokeWidth={1.5} />
            <h3>Vacation Periods</h3>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
            <Plus size={16} strokeWidth={2} />
            Add Vacation
          </button>
        </div>

        {showForm && (
          <div className="vacation-form">
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">From Date</label>
                <input
                  type="date"
                  className="form-input"
                  value={formData.startDate}
                  min={today}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">To Date</label>
                <input
                  type="date"
                  className="form-input"
                  value={formData.endDate}
                  min={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Reason (optional)</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g., Family vacation, Medical leave"
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
              />
            </div>
            {error && (
              <div className="form-error" style={{ color: 'var(--status-error)', marginBottom: '12px', fontSize: '14px' }}>
                {error}
              </div>
            )}
            <div className="form-actions">
              <button className="btn btn-ghost" onClick={() => { setShowForm(false); setError(''); }}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSubmit}>
                Add Vacation
              </button>
            </div>
          </div>
        )}

        <div className="vacations-list">
          {sortedVacations.length === 0 ? (
            <div className="empty-state">
              <Umbrella size={32} strokeWidth={1} />
              <p>No vacations scheduled</p>
              <span>Plan your time off by adding vacation periods</span>
            </div>
          ) : (
            sortedVacations.map((item) => {
              const status = getVacationStatus(item.endDate);
              const daysCount = getDaysCount(item.startDate, item.endDate);
              return (
                <div key={item.id} className={`vacation-card ${status}`}>
                  <div className="vacation-card-dates">
                    <Calendar size={14} strokeWidth={2} />
                    <span>{formatDateRange(item.startDate, item.endDate)}</span>
                  </div>
                  <div className="vacation-card-duration">
                    {daysCount} day{daysCount > 1 ? 's' : ''}
                  </div>
                  {item.reason && <div className="vacation-card-reason">{item.reason}</div>}
                  <div className={`vacation-status-badge ${status}`}>
                    {status === 'upcoming' ? 'Upcoming' : 'Past'}
                  </div>
                  <button className="vacation-delete-btn" onClick={() => handleDelete(item.id)}>
                    <Trash2 size={16} strokeWidth={2} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default function MyAvailability() {
  const { currentBarber, barberBranch, updateBarber } = useApp();
  const [activeTab, setActiveTab] = useState('schedule');
  const [schedule, setSchedule] = useState(DEFAULT_SCHEDULE);
  const [timeOffs, setTimeOffs] = useState([]);
  const [vacations, setVacations] = useState([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Only initialize state from currentBarber on first load, not on every change
  useEffect(() => {
    if (currentBarber && !isInitialized) {
      if (currentBarber.availability) {
        setSchedule(convertAvailabilityFormat(currentBarber.availability));
      }
      setTimeOffs(currentBarber.timeOffs || []);
      setVacations(currentBarber.vacations || []);
      setIsInitialized(true);
    }
  }, [currentBarber, isInitialized]);

  const handleDayChange = (dayKey, newSchedule) => {
    setSchedule((prev) => ({
      ...prev,
      [dayKey]: newSchedule,
    }));
    setHasChanges(true);
    setSaveStatus(null);
  };

  const handleAddTimeOff = (timeOff) => {
    setTimeOffs((prev) => [...prev, timeOff]);
  };

  const handleDeleteTimeOff = (id) => {
    setTimeOffs((prev) => prev.filter((t) => t.id !== id));
  };

  const handleAddVacation = (vacation) => {
    setVacations((prev) => [...prev, vacation]);
  };

  const handleDeleteVacation = (id) => {
    setVacations((prev) => prev.filter((v) => v.id !== id));
  };

  const handleSave = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await updateBarber(currentBarber.id, {
        availability: schedule,
        timeOffs: timeOffs,
        vacations: vacations,
      });
      setHasChanges(false);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (error) {
      console.error('Error saving availability:', error);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(null), 3000);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    if (currentBarber) {
      if (currentBarber.availability) {
        setSchedule(convertAvailabilityFormat(currentBarber.availability));
      } else {
        setSchedule(DEFAULT_SCHEDULE);
      }
      setTimeOffs(currentBarber.timeOffs || []);
      setVacations(currentBarber.vacations || []);
    }
    setHasChanges(false);
    setSaveStatus(null);
  };

  const copyHoursToAll = (sourceDay) => {
    const sourceSchedule = schedule[sourceDay];
    const newSchedule = {};
    DAYS_OF_WEEK.forEach(({ key }) => {
      newSchedule[key] = { ...sourceSchedule };
    });
    setSchedule(newSchedule);
    setHasChanges(true);
    setSaveStatus(null);
  };

  const workingDays = Object.values(schedule).filter((d) => d.enabled).length;
  const totalHours = calculateTotalHours(schedule);
  const upcomingVacations = vacations.filter((v) => {
    const end = new Date(v.endDate);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return end >= now;
  }).length;

  if (!currentBarber) return null;

  return (
    <div className="availability-page">
      <div className="page-header animate-fade-in">
        <div className="page-header-content">
          <h2 className="page-title">My Availability</h2>
          <p className="page-description">
            Manage your schedule at {barberBranch?.name}
          </p>
        </div>
        <div className="page-actions">
          {hasChanges && (
            <button className="btn btn-ghost" onClick={handleReset}>
              <RotateCcw size={18} strokeWidth={2} />
              Reset
            </button>
          )}
          <button
            className={`btn btn-primary ${!hasChanges || isSubmitting ? 'disabled' : ''}`}
            onClick={handleSave}
            disabled={!hasChanges || isSubmitting}
          >
            {isSubmitting ? (
              'Saving...'
            ) : (
              <>
                <Save size={18} strokeWidth={2} />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>

      {saveStatus === 'saved' && (
        <div className="save-notification animate-fade-in">
          <Check size={16} strokeWidth={2} />
          <span>Changes saved successfully</span>
        </div>
      )}

      {/* Summary Cards */}
      <div className="availability-summary animate-fade-in-up stagger-1">
        <div className="summary-card">
          <div className="summary-icon">
            <Calendar size={24} strokeWidth={1.5} />
          </div>
          <div className="summary-content">
            <div className="summary-value">{workingDays}</div>
            <div className="summary-label">Working Days</div>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon">
            <Clock size={24} strokeWidth={1.5} />
          </div>
          <div className="summary-content">
            <div className="summary-value">{totalHours}</div>
            <div className="summary-label">Hours / Week</div>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon">
            <Coffee size={24} strokeWidth={1.5} />
          </div>
          <div className="summary-content">
            <div className="summary-value">{timeOffs.length}</div>
            <div className="summary-label">Time-Offs</div>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon">
            <Umbrella size={24} strokeWidth={1.5} />
          </div>
          <div className="summary-content">
            <div className="summary-value">{upcomingVacations}</div>
            <div className="summary-label">Upcoming Vacations</div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="availability-tabs animate-fade-in-up stagger-2">
        <button
          className={`tab-btn ${activeTab === 'schedule' ? 'active' : ''}`}
          onClick={() => setActiveTab('schedule')}
        >
          <Calendar size={18} strokeWidth={2} />
          Weekly Schedule
        </button>
        <button
          className={`tab-btn ${activeTab === 'timeoffs' ? 'active' : ''}`}
          onClick={() => setActiveTab('timeoffs')}
        >
          <Coffee size={18} strokeWidth={2} />
          Time-Off
          {timeOffs.length > 0 && <span className="tab-badge">{timeOffs.length}</span>}
        </button>
        <button
          className={`tab-btn ${activeTab === 'vacations' ? 'active' : ''}`}
          onClick={() => setActiveTab('vacations')}
        >
          <Umbrella size={18} strokeWidth={2} />
          Vacations
          {upcomingVacations > 0 && <span className="tab-badge">{upcomingVacations}</span>}
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'schedule' && (
        <div className="schedule-card animate-fade-in-up">
          <div className="schedule-card-header">
            <div className="schedule-card-title">
              <Clock size={20} strokeWidth={1.5} />
              <h3>Weekly Schedule</h3>
            </div>
            <div className="schedule-legend">
              <span className="schedule-legend-item">
                <span className="legend-dot active"></span>
                Working
              </span>
              <span className="schedule-legend-item">
                <span className="legend-dot off"></span>
                Day Off
              </span>
            </div>
          </div>

          <div className="schedule-grid">
            <div className="schedule-grid-header">
              <div className="schedule-col day">Day</div>
              <div className="schedule-col times">Working Hours</div>
              <div className="schedule-col hours">Total</div>
            </div>

            {DAYS_OF_WEEK.map((day) => (
              <DayScheduleRow
                key={day.key}
                day={day}
                schedule={schedule[day.key]}
                onChange={(newSchedule) => handleDayChange(day.key, newSchedule)}
                onCopyToAll={() => copyHoursToAll(day.key)}
              />
            ))}
          </div>

          <div className="schedule-footer">
            <div className="schedule-total">
              <span>Total Weekly Hours:</span>
              <strong>{totalHours}h</strong>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'timeoffs' && (
        <TimeOffSection
          timeOffs={timeOffs}
          onAdd={handleAddTimeOff}
          onDelete={handleDeleteTimeOff}
          setHasChanges={setHasChanges}
          schedule={schedule}
        />
      )}

      {activeTab === 'vacations' && (
        <VacationsSection
          vacations={vacations}
          onAdd={handleAddVacation}
          onDelete={handleDeleteVacation}
          setHasChanges={setHasChanges}
        />
      )}

      {/* Tips */}
      <div className="availability-tips animate-fade-in-up stagger-3">
        <h4>Tips</h4>
        <ul>
          {activeTab === 'schedule' && (
            <>
              <li>Click the toggle to enable/disable working days</li>
              <li>Customers can only book during your available hours</li>
            </>
          )}
          {activeTab === 'timeoffs' && (
            <>
              <li>Time-offs are recurring blocks that repeat every week</li>
              <li>Use them for lunch breaks or regular appointments</li>
            </>
          )}
          {activeTab === 'vacations' && (
            <>
              <li>Vacations block entire date ranges</li>
              <li>Customers cannot book during your vacation periods</li>
            </>
          )}
          <li>Changes are applied immediately after saving</li>
        </ul>
      </div>
    </div>
  );
}
