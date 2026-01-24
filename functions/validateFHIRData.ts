import { createClientFromRequest } from 'npm:@api/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const api = createClientFromRequest(req);
    
    const user = await api.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { fhir_resource, resource_type } = await req.json();

    // Get active validation rules
    const allRules = await api.asServiceRole.entities.EHRValidationRule.filter({
      is_active: true
    });

    // Filter rules applicable to this resource type
    const applicableRules = allRules.filter(rule => 
      !rule.apply_to_resource_types || 
      rule.apply_to_resource_types.length === 0 ||
      rule.apply_to_resource_types.includes(resource_type)
    );

    const validationResults = {
      valid: true,
      errors: [],
      warnings: [],
      checked_rules: applicableRules.length
    };

    // Helper to get nested property value
    const getNestedValue = (obj, path) => {
      return path.split('.').reduce((current, key) => {
        // Handle array notation like identifier[0]
        const arrayMatch = key.match(/^(\w+)\[(\d+)\]$/);
        if (arrayMatch) {
          return current?.[arrayMatch[1]]?.[parseInt(arrayMatch[2])];
        }
        return current?.[key];
      }, obj);
    };

    // Validate each rule
    for (const rule of applicableRules) {
      const fieldValue = getNestedValue(fhir_resource, rule.target_field);
      let isValid = true;
      let errorMsg = rule.error_message || `Validation failed for ${rule.target_field}`;

      switch (rule.rule_type) {
        case 'required_field':
          isValid = fieldValue !== undefined && fieldValue !== null && fieldValue !== '';
          if (!isValid) {
            errorMsg = rule.error_message || `Required field '${rule.target_field}' is missing`;
          }
          break;

        case 'date_format':
          if (fieldValue) {
            const dateFormat = rule.validation_config?.date_format || 'YYYY-MM-DD';
            // Simple date format validation (can be enhanced)
            if (dateFormat === 'YYYY-MM-DD') {
              isValid = /^\d{4}-\d{2}-\d{2}$/.test(fieldValue);
            } else if (dateFormat === 'YYYY-MM-DD HH:mm:ss') {
              isValid = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(fieldValue);
            }
            if (!isValid) {
              errorMsg = rule.error_message || `Date field '${rule.target_field}' must match format ${dateFormat}`;
            }
          }
          break;

        case 'value_range':
          if (fieldValue !== undefined && fieldValue !== null) {
            const numValue = parseFloat(fieldValue);
            const min = rule.validation_config?.min_value;
            const max = rule.validation_config?.max_value;
            
            if (min !== undefined && numValue < min) {
              isValid = false;
              errorMsg = rule.error_message || `Field '${rule.target_field}' (${numValue}) is below minimum (${min})`;
            }
            if (max !== undefined && numValue > max) {
              isValid = false;
              errorMsg = rule.error_message || `Field '${rule.target_field}' (${numValue}) exceeds maximum (${max})`;
            }
          }
          break;

        case 'enum_check':
          if (fieldValue) {
            const allowedValues = rule.validation_config?.allowed_values || [];
            isValid = allowedValues.includes(fieldValue);
            if (!isValid) {
              errorMsg = rule.error_message || `Field '${rule.target_field}' must be one of: ${allowedValues.join(', ')}`;
            }
          }
          break;

        case 'regex_pattern':
          if (fieldValue) {
            const pattern = rule.validation_config?.pattern;
            if (pattern) {
              const regex = new RegExp(pattern);
              isValid = regex.test(fieldValue);
              if (!isValid) {
                errorMsg = rule.error_message || `Field '${rule.target_field}' does not match required pattern`;
              }
            }
          }
          break;
      }

      if (!isValid) {
        const validationError = {
          rule_name: rule.rule_name,
          field: rule.target_field,
          message: errorMsg,
          severity: rule.severity
        };

        if (rule.severity === 'error') {
          validationResults.errors.push(validationError);
          validationResults.valid = false;
        } else {
          validationResults.warnings.push(validationError);
        }
      }
    }

    return Response.json(validationResults);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});