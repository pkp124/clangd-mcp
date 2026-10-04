#pragma once

class Widget {
public:
  virtual int value() const;
};

class Derived : public Widget {
public:
  int value() const override;
};

int compute(const Widget &w);
