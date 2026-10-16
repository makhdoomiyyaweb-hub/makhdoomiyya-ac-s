import React from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';

/**
 * AnalyticsErrorBoundary
 * Isolates any runtime error occurring inside the Smart Assistant plugin
 * so that the main application (Cashbook, Income, Expenses, Sync) NEVER crashes.
 */
export default class AnalyticsErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.warn('[SmartAssistant Plugin Sandbox Error caught]:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) this.props.onReset();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 bg-amber-50/90 border border-amber-200 rounded-2xl text-center space-y-3 my-4 max-w-lg mx-auto shadow-sm">
          <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mx-auto">
            <AlertCircle size={24} />
          </div>
          <h3 className="text-base font-bold text-amber-900">
            സ്മാർട്ട് അസിസ്റ്റന്റ് താൽക്കാലികമായി ലഭ്യമല്ല
          </h3>
          <p className="text-xs text-amber-800 leading-relaxed">
            അനലിറ്റിക്സ് പ്ലഗ്ഗിനിൽ ഒരു അപ്രതീക്ഷിത തടസ്സം നേരിട്ടു. എന്നാൽ പ്രധാന ആപ്പിന്റെ ഡാറ്റയും അക്കൗണ്ടിംഗ് പ്രവർത്തനങ്ങളും 100% സുരക്ഷിതമാണ്.
          </p>
          <div className="pt-2 flex justify-center gap-3">
            <button
              onClick={this.handleReset}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw size={14} /> വീണ്ടും ശ്രമിക്കുക
            </button>
            {this.props.onClose && (
              <button
                onClick={this.props.onClose}
                className="px-4 py-2 bg-white border border-amber-300 hover:bg-amber-100 text-amber-900 rounded-lg text-xs font-semibold transition-colors"
              >
                അടയ്ക്കുക
              </button>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
