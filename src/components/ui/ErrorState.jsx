import React from 'react';

export default function ErrorState({ title, message }) {
  return (
    <div className="p-6">
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <h3 className="text-red-800 font-semibold text-lg mb-2">{title || 'Something went wrong'}</h3>
        <p className="text-red-600">{message || 'Please try again or contact your administrator.'}</p>
      </div>
    </div>
  );
}
