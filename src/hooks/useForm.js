import { useState } from 'react';
import { localToday, readEntryDate, writeEntryDate } from '../utils/entryDate';

export function useForm({ initialValues, validate, onSubmit, dateStorageKey }) {
  const [values, setValues] = useState(() => dateStorageKey
    ? { ...initialValues, date: readEntryDate(dateStorageKey, localToday()) }
    : initialValues);
  const [errors, setErrors] = useState({});

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'date' && dateStorageKey) writeEntryDate(dateStorageKey, value);
    setValues({
      ...values,
      [name]: value,
    });
    // clear error for this field
    if (errors[name]) {
      setErrors({ ...errors, [name]: undefined });
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const validationErrors = validate ? validate(values) : {};
    if (Object.keys(validationErrors).length > 0) {
      if (validationErrors.paymentStatus) {
        import('react-hot-toast').then(toast => toast.default.error(validationErrors.paymentStatus));
      }
      setErrors(validationErrors);
      return;
    }
    onSubmit(values);
  };

  const resetForm = () => {
    setValues(previous => dateStorageKey ? { ...initialValues, date: previous.date } : initialValues);
    setErrors({});
  };

  return { values, errors, handleChange, handleSubmit, resetForm, setValues };
}
