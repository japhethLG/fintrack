"use client";

import React from "react";
import { Icon } from "./Icon";
import { cn } from "@/lib/utils/cn";

export interface SelectOption {
	value: string;
	label: string;
	disabled?: boolean;
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange"> {
	label?: string;
	error?: string;
	options: SelectOption[];
	onChange?: (value: string) => void;
	className?: string;
}

export const Select: React.FC<SelectProps> = ({
	label,
	error,
	options,
	onChange,
	className = "",
	disabled,
	id,
	value,
	...props
}) => {
	const selectId = id || (label ? `select-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);

	const baseSelectStyles =
		"w-full bg-[#151c2c] border rounded-lg p-3 text-white focus:outline-none transition-colors duration-200 appearance-none cursor-pointer";

	const combinedSelectClassName = cn(
		baseSelectStyles,
		error
			? "border-danger focus:border-danger focus:ring-2 focus:ring-danger/20"
			: "border-gray-700 focus:border-primary focus:ring-2 focus:ring-primary/20",
		disabled && "opacity-50 cursor-not-allowed",
		className
	);

	const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		if (onChange) {
			onChange(e.target.value);
		}
		if (props.onChange) {
			props.onChange(e);
		}
	};

	return (
		<div className="w-full">
			{label && (
				<label
					htmlFor={selectId}
					className="block text-sm font-medium text-gray-400 mb-2"
				>
					{label}
				</label>
			)}
			<div className="relative">
				<select
					id={selectId}
					className={combinedSelectClassName}
					disabled={disabled}
					value={value}
					onChange={handleChange}
					aria-invalid={error ? "true" : "false"}
					aria-describedby={error ? `${selectId}-error` : undefined}
					{...props}
				>
					{options.map((option) => (
						<option
							key={option.value}
							value={option.value}
							disabled={option.disabled}
							className="bg-[#151c2c] text-white"
						>
							{option.label}
						</option>
					))}
				</select>
				<div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
					<Icon name="expand_more" size="lg" className="text-gray-500" />
				</div>
			</div>
			{error && (
				<p
					id={error ? `${selectId}-error` : undefined}
					className="mt-1 text-sm text-danger"
					role="alert"
				>
					{error}
				</p>
			)}
		</div>
	);
};

