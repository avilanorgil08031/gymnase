-- Align shop sales payment methods with subscription/payment methods.
ALTER TABLE sales
  MODIFY payment_method ENUM('CASH', 'WAVE', 'ORANGE_MONEY', 'MTN_MONEY', 'CARD', 'BANK_TRANSFER') NOT NULL;
