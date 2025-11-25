"use client";

import React, { useState } from "react";
import { Icon } from "./Icon";
import { cn } from "@/lib/utils/cn";

export interface AlertProps {
	variant?: "error" | "success" | "warning" | "info";
	dismissible?: boolean;
	icon?: React.ReactNode;
	title?: string;
	className?: string;
	children: React.ReactNode;
}

export const Alert: React.FC<AlertProps> = ({
	variant = "info",
	dismissible = false,
	icon,
	title,
	className = "",
	children,
}) => {
	const [isVisible, setIsVisible] = useState(true);

	if (!isVisible) return null;

	const baseStyles = "p-4 rounded-lg border text-sm";

	const variantStyles = {
		error: "bg-danger/20 border-danger/30 text-danger",
		success: "bg-success/20 border-success/30 text-success",
		warning: "bg-warning/20 border-warning/30 text-warning",
		info: "bg-primary/20 border-primary/30 text-primary",
	};

	const combinedClassName = cn(baseStyles, variantStyles[variant], className);

	const defaultIcons = {
		error: <Icon name="error" />,
		success: <Icon name="check_circle" />,
		warning: <Icon name="warning" />,
		info: <Icon name="info" />,
	};

	const displayIcon = icon || defaultIcons[variant];

	return (
		<div
			className={combinedClassName}
			role="alert"
		>
			<div className="flex items-start gap-3">
				{displayIcon && <span className="flex-shrink-0 mt-0.5">{displayIcon}</span>}
				<div className="flex-1">
					{title && <h4 className="font-bold mb-1">{title}</h4>}
					<div>{children}</div>
				</div>
				{dismissible && (
					<button
						onClick={() => setIsVisible(false)}
						className="flex-shrink-0 hover:opacity-70 transition-opacity"
						aria-label="Dismiss alert"
					>
						<Icon name="close" size="lg" />
					</button>
				)}
			</div>
		</div>
	);
};

